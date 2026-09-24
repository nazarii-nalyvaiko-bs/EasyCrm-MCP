import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAutomaticDiscount,
  createPercentageCodeDiscount,
  deleteAutomaticDiscount,
  deleteCodeDiscount,
  listAutomaticDiscounts,
  listCodeDiscounts,
  updateAutomaticDiscount,
  updateCodeDiscount,
} from "../dist/shopify/operations/discounts.js";

function clientReturning(data) {
  const calls = [];
  return {
    calls,
    client: {
      query: async (document, variables) => {
        calls.push({ document, variables });
        return data;
      },
    },
  };
}

test("lists code discounts with pagination", async () => {
  const page = {
    nodes: [{ id: "gid://shopify/DiscountCodeNode/1", codeDiscount: { __typename: "DiscountCodeBasic" } }],
    pageInfo: { hasNextPage: true, endCursor: "next" },
  };
  const { calls, client } = clientReturning({ codeDiscountNodes: page });

  assert.deepEqual(await listCodeDiscounts(client, 5, "previous"), page);
  assert.match(calls[0].document, /codeDiscountNodes\(first: \$first, after: \$after\)/);
  assert.deepEqual(calls[0].variables, { first: 5, after: "previous" });
});

test("creates a percentage code discount using Shopify's fraction format", async () => {
  const id = "gid://shopify/DiscountCodeNode/2";
  const { calls, client } = clientReturning({
    discountCodeBasicCreate: { codeDiscountNode: { id }, userErrors: [] },
  });

  assert.deepEqual(await createPercentageCodeDiscount(client, {
    title: "Welcome",
    code: "WELCOME20",
    startsAt: "2026-09-25T00:00:00Z",
    percentage: 20,
  }), { id });
  assert.deepEqual(calls[0].variables.input, {
    title: "Welcome",
    code: "WELCOME20",
    startsAt: "2026-09-25T00:00:00Z",
    context: { all: "ALL" },
    customerGets: { value: { percentage: 0.2 }, items: { all: true } },
  });
});

test("rejects invalid percentage before sending a mutation", async () => {
  const { calls, client } = clientReturning({});
  await assert.rejects(createPercentageCodeDiscount(client, {
    title: "Invalid",
    code: "INVALID",
    startsAt: "2026-09-25T00:00:00Z",
    percentage: 110,
  }), /percentage/);
  assert.equal(calls.length, 0);
});

test("updates only fields provided and rejects empty updates", async () => {
  const id = "gid://shopify/DiscountCodeNode/3";
  const { calls, client } = clientReturning({
    discountCodeBasicUpdate: { codeDiscountNode: { id }, userErrors: [] },
  });

  await assert.rejects(updateCodeDiscount(client, id, {}), /at least one/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await updateCodeDiscount(client, id, { endsAt: null }), { id });
  assert.deepEqual(calls[0].variables, { id, input: { endsAt: null } });
});

test("reports Shopify user errors instead of claiming the discount was created", async () => {
  const { client } = clientReturning({
    discountCodeBasicCreate: {
      codeDiscountNode: null,
      userErrors: [{ field: ["code"], message: "Code already exists" }],
    },
  });
  await assert.rejects(createPercentageCodeDiscount(client, {
    title: "Welcome",
    code: "WELCOME20",
    startsAt: "2026-09-25T00:00:00Z",
    percentage: 20,
  }), /Code already exists/);
});

test("deletes a code discount and returns the deleted ID", async () => {
  const id = "gid://shopify/DiscountCodeNode/4";
  const { calls, client } = clientReturning({
    discountCodeDelete: { deletedCodeDiscountId: id, userErrors: [] },
  });
  assert.deepEqual(await deleteCodeDiscount(client, id), { id });
  assert.deepEqual(calls[0].variables, { id });
});

test("lists automatic discounts with their own node IDs", async () => {
  const page = {
    nodes: [{ id: "gid://shopify/DiscountAutomaticNode/5", automaticDiscount: { __typename: "DiscountAutomaticBasic" } }],
    pageInfo: { hasNextPage: false, endCursor: null },
  };
  const { calls, client } = clientReturning({ automaticDiscountNodes: page });
  assert.deepEqual(await listAutomaticDiscounts(client, 10), page);
  assert.match(calls[0].document, /automaticDiscountNodes\(first: \$first, after: \$after\)/);
});

test("creates a percentage automatic discount for all buyers and items", async () => {
  const id = "gid://shopify/DiscountAutomaticNode/6";
  const { calls, client } = clientReturning({
    discountAutomaticBasicCreate: { automaticDiscountNode: { id }, userErrors: [] },
  });
  assert.deepEqual(await createAutomaticDiscount(client, {
    title: "Autumn offer",
    startsAt: "2026-09-25T00:00:00Z",
    value: { kind: "percentage", percentage: 15 },
  }), { id });
  assert.deepEqual(calls[0].variables.input, {
    title: "Autumn offer",
    startsAt: "2026-09-25T00:00:00Z",
    context: { all: "ALL" },
    customerGets: { value: { percentage: 0.15 }, items: { all: true } },
  });
});

test("creates a fixed amount automatic discount once per order", async () => {
  const id = "gid://shopify/DiscountAutomaticNode/7";
  const { calls, client } = clientReturning({
    discountAutomaticBasicCreate: { automaticDiscountNode: { id }, userErrors: [] },
  });
  await createAutomaticDiscount(client, {
    title: "Order offer",
    startsAt: "2026-09-25T00:00:00Z",
    value: { kind: "fixedAmount", amount: "20.00" },
  });
  assert.deepEqual(calls[0].variables.input.customerGets.value, {
    discountAmount: { amount: "20.00", appliesOnEachItem: false },
  });
});

test("rejects invalid automatic amount without sending a mutation", async () => {
  const { calls, client } = clientReturning({});
  await assert.rejects(createAutomaticDiscount(client, {
    title: "Invalid",
    startsAt: "2026-09-25T00:00:00Z",
    value: { kind: "fixedAmount", amount: "0.00" },
  }), /greater than 0/);
  assert.equal(calls.length, 0);
});

test("updates automatic discount metadata without changing its value", async () => {
  const id = "gid://shopify/DiscountAutomaticNode/8";
  const { calls, client } = clientReturning({
    discountAutomaticBasicUpdate: { automaticDiscountNode: { id }, userErrors: [] },
  });
  await assert.rejects(updateAutomaticDiscount(client, id, {}), /at least one/);
  assert.deepEqual(await updateAutomaticDiscount(client, id, { endsAt: null }), { id });
  assert.deepEqual(calls[0].variables, { id, input: { endsAt: null } });
});

test("deletes an automatic discount by automatic node ID", async () => {
  const id = "gid://shopify/DiscountAutomaticNode/9";
  const { calls, client } = clientReturning({
    discountAutomaticDelete: { deletedAutomaticDiscountId: id, userErrors: [] },
  });
  assert.deepEqual(await deleteAutomaticDiscount(client, id), { id });
  assert.deepEqual(calls[0].variables, { id });
});
