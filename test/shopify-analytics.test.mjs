import assert from "node:assert/strict";
import { test } from "node:test";
import { getSalesReport } from "../dist/shopify/operations/analytics.js";
import { registerShopifyAnalyticsTools } from "../dist/tools/shopify-analytics.js";

const table = {
  columns: [
    { name: "day", dataType: "DAY_TIMESTAMP", displayName: "Day" },
    { name: "total_sales", dataType: "MONEY", displayName: "Total sales" },
  ],
  rows: [{ day: "2026-09-01", total_sales: "123.45" }],
};

test("native sales report builds only allowlisted ShopifyQL and preserves table metadata", async () => {
  let gqlVariables;
  const client = { query: async (_query, variables) => {
    gqlVariables = variables;
    return { shopifyqlQuery: { parseErrors: [], tableData: table } };
  } };
  const report = await getSalesReport(client, {
    from: "2026-09-01", to: "2026-09-30", interval: "day",
    metrics: ["total_sales", "orders"], limit: 5,
  });
  assert.equal(gqlVariables.query,
    "FROM sales\nSHOW total_sales, orders\nTIMESERIES day\nSINCE 2026-09-01 UNTIL 2026-09-30\nORDER BY day ASC\nLIMIT 5");
  assert.equal(report.source, "Shopify Analytics via ShopifyQL");
  assert.equal(report.dateBounds, "inclusive");
  assert.deepEqual(report.columns, table.columns);
  assert.deepEqual(report.rows, table.rows);
  assert.equal(report.possiblyTruncated, false);
});

test("total report does not add a timeseries or row limit", async () => {
  let gqlVariables;
  const client = { query: async (_query, variables) => {
    gqlVariables = variables;
    return { shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } } };
  } };
  const report = await getSalesReport(client, {
    from: "2026-09-01", to: "2026-09-30", interval: "total", metrics: ["net_sales"],
  });
  assert.doesNotMatch(gqlVariables.query, /TIMESERIES|LIMIT/);
  assert.equal(report.rowLimit, null);
});

test("rejects invalid dates, unsupported metrics, and conflicting limit before API calls", async () => {
  const client = { query: async () => { throw new Error("Should not call Shopify"); } };
  const valid = { from: "2026-09-01", to: "2026-09-30", interval: "day", metrics: ["orders"] };
  await assert.rejects(() => getSalesReport(client, { ...valid, from: "2026-02-30" }), /valid calendar/);
  await assert.rejects(() => getSalesReport(client, { ...valid, from: "2026-10-01" }), /from must not/);
  await assert.rejects(() => getSalesReport(client, { ...valid, metrics: ["all_sales"] }), /Unsupported/);
  await assert.rejects(() => getSalesReport(client, { ...valid, interval: "total", limit: 5 }), /only to day or month/);
});

test("treats ShopifyQL parse errors and missing tables as failures", async () => {
  const input = { from: "2026-09-01", to: "2026-09-30", interval: "month", metrics: ["total_sales"] };
  const syntax = { query: async () => ({ shopifyqlQuery: { parseErrors: ["Unknown metric"], tableData: null } }) };
  await assert.rejects(() => getSalesReport(syntax, input), /Unknown metric/);
  const noTable = { query: async () => ({ shopifyqlQuery: { parseErrors: [], tableData: null } }) };
  await assert.rejects(() => getSalesReport(noTable, input), /no valid table data/);
  const malformed = { query: async () => ({ shopifyqlQuery: { parseErrors: [1], tableData: table } }) };
  await assert.rejects(() => getSalesReport(malformed, input), /invalid sales report/);
});

test("flags a series at its result limit as possibly truncated", async () => {
  const client = { query: async () => ({ shopifyqlQuery: { parseErrors: [], tableData: table } }) };
  const report = await getSalesReport(client, {
    from: "2026-09-01", to: "2026-09-30", interval: "day", metrics: ["orders"], limit: 1,
  });
  assert.equal(report.possiblyTruncated, true);
});

test("registers a read-only native Shopify analytics tool", () => {
  const tools = new Map();
  registerShopifyAnalyticsTools({ registerTool(name, config) { tools.set(name, config); } }, {});
  assert.equal(tools.size, 1);
  assert.equal(tools.get("shopify_sales_report").annotations.readOnlyHint, true);
});
