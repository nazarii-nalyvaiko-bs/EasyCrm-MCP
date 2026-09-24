import { z } from "zod";
import type { ShopifyClient } from "../client.js";

const SALES_METRICS = [
  "total_sales",
  "orders",
  "gross_sales",
  "discounts",
  "net_sales",
  "average_order_value",
] as const;

export type SalesMetric = (typeof SALES_METRICS)[number];
export type SalesInterval = "total" | "day" | "month";

export interface SalesReportInput {
  from: string;
  to: string;
  interval: SalesInterval;
  metrics: SalesMetric[];
  limit?: number;
}

const reportSchema = z.object({
  shopifyqlQuery: z.object({
    parseErrors: z.array(z.string()),
    tableData: z.unknown(),
  }).nullable(),
});

const tableSchema = z.object({
  columns: z.array(z.object({
    name: z.string(),
    dataType: z.string(),
    displayName: z.string(),
  })),
  rows: z.array(z.record(z.string(), z.unknown())),
});

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("Report dates must use YYYY-MM-DD");
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("Report dates must be valid calendar dates");
  }
}

function buildSalesQuery(input: SalesReportInput): string {
  assertDate(input.from);
  assertDate(input.to);
  if (input.from > input.to) throw new Error("from must not be later than to");
  if (!["total", "day", "month"].includes(input.interval)) throw new Error("Unsupported sales interval");
  if (!input.metrics.length || input.metrics.some((metric) => !SALES_METRICS.includes(metric))) {
    throw new Error("Unsupported or empty sales metrics");
  }
  if (new Set(input.metrics).size !== input.metrics.length) throw new Error("Duplicate sales metrics");
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000)) {
    throw new Error("limit must be between 1 and 1000");
  }
  if (input.interval === "total" && input.limit !== undefined) {
    throw new Error("limit applies only to day or month series");
  }

  const clauses = [
    "FROM sales",
    `SHOW ${input.metrics.join(", ")}`,
  ];
  if (input.interval !== "total") clauses.push(`TIMESERIES ${input.interval}`);
  clauses.push(`SINCE ${input.from} UNTIL ${input.to}`);
  if (input.interval !== "total") {
    clauses.push(`ORDER BY ${input.interval} ASC`);
    clauses.push(`LIMIT ${input.limit ?? 1000}`);
  }
  return clauses.join("\n");
}

export async function getSalesReport(client: ShopifyClient, input: SalesReportInput) {
  const query = buildSalesQuery(input);
  const response = await client.query<unknown>(
    `query ShopifySalesReport($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData { columns { name dataType displayName } rows }
        parseErrors
      }
    }`,
    { query },
  );
  const parsed = reportSchema.safeParse(response);
  if (!parsed.success || !parsed.data.shopifyqlQuery) {
    throw new Error("Shopify returned an invalid sales report");
  }
  const report = parsed.data.shopifyqlQuery;
  if (report.parseErrors.length) {
    throw new Error(`ShopifyQL rejected the report: ${report.parseErrors.join("; ")}`);
  }
  const table = tableSchema.safeParse(report.tableData);
  if (!table.success) {
    throw new Error("ShopifyQL returned no valid table data");
  }
  const rowLimit = input.interval === "total" ? null : input.limit ?? 1000;
  return {
    source: "Shopify Analytics via ShopifyQL",
    from: input.from,
    to: input.to,
    dateBounds: "inclusive",
    interval: input.interval,
    metrics: input.metrics,
    columns: table.data.columns,
    rows: table.data.rows,
    rowLimit,
    possiblyTruncated: rowLimit !== null && table.data.rows.length >= rowLimit,
  };
}
