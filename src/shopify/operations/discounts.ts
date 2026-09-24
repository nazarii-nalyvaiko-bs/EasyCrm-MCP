import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { confirmDeletedId, unwrapMutation } from "./mutation.js";

export interface CodeDiscount {
  id: string;
  codeDiscount: {
    __typename: string;
    title?: string;
    summary?: string;
    status?: string;
    startsAt?: string;
    endsAt?: string | null;
    codes?: { nodes: { code: string }[] };
  };
}

export interface CodeDiscountPage {
  nodes: CodeDiscount[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface AutomaticDiscount {
  id: string;
  automaticDiscount: {
    __typename: string;
    title?: string;
    summary?: string;
    status?: string;
    startsAt?: string;
    endsAt?: string | null;
  };
}

export interface AutomaticDiscountPage {
  nodes: AutomaticDiscount[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface PercentageCodeDiscountInput {
  title: string;
  code: string;
  startsAt: string;
  endsAt?: string | null;
  percentage: number;
  usageLimit?: number | null;
  appliesOncePerCustomer?: boolean;
}

export interface FixedCodeDiscountInput extends Omit<PercentageCodeDiscountInput, "percentage"> {
  amount: string;
}

export interface CodeDiscountUpdateInput {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  usageLimit?: number | null;
  appliesOncePerCustomer?: boolean;
}

export interface AutomaticDiscountCreateInput {
  title: string;
  startsAt: string;
  endsAt?: string | null;
  value: { kind: "percentage"; percentage: number } | { kind: "fixedAmount"; amount: string };
}

export interface AutomaticDiscountUpdateInput {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
}

interface DiscountMutationPayload {
  codeDiscountNode: { id: string } | null;
  userErrors: UserError[];
}

const LIST_CODE_DISCOUNTS = `
  query ListCodeDiscounts($first: Int!, $after: String) {
    codeDiscountNodes(first: $first, after: $after) {
      nodes {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title summary status startsAt endsAt
            codes(first: 10) { nodes { code } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export async function listCodeDiscounts(
  client: ShopifyClient,
  first = 20,
  after?: string,
): Promise<CodeDiscountPage> {
  const data = await client.query<{ codeDiscountNodes: CodeDiscountPage }>(LIST_CODE_DISCOUNTS, {
    first,
    after,
  });
  return data.codeDiscountNodes;
}

const CREATE_BASIC_CODE_DISCOUNT = `
  mutation CreateBasicCodeDiscount($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

export async function createPercentageCodeDiscount(
  client: ShopifyClient,
  input: PercentageCodeDiscountInput,
): Promise<{ id: string }> {
  assertPercentage(input.percentage);
  const { percentage, ...options } = input;
  return createBasicCodeDiscount(client, options, { percentage: percentage / 100 });
}

export async function createFixedCodeDiscount(
  client: ShopifyClient,
  input: FixedCodeDiscountInput,
): Promise<{ id: string }> {
  assertFixedAmount(input.amount);
  const { amount, ...options } = input;
  return createBasicCodeDiscount(client, options, {
    discountAmount: { amount, appliesOnEachItem: false },
  });
}

async function createBasicCodeDiscount(
  client: ShopifyClient,
  options: Omit<PercentageCodeDiscountInput, "percentage">,
  value: { percentage: number } | { discountAmount: { amount: string; appliesOnEachItem: false } },
): Promise<{ id: string }> {
  const data = await client.query<{ discountCodeBasicCreate: DiscountMutationPayload }>(
    CREATE_BASIC_CODE_DISCOUNT,
    {
      input: {
        ...options,
        context: { all: "ALL" },
        customerGets: { value, items: { all: true } },
      },
    },
  );
  return unwrapMutation(
    "discountCodeBasicCreate",
    data.discountCodeBasicCreate.codeDiscountNode,
    data.discountCodeBasicCreate.userErrors,
  );
}

function assertFixedAmount(amount: string): void {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error("amount must be a decimal string with up to two fractional digits");
  }
  if (Number(amount) <= 0) {
    throw new Error("amount must be greater than 0");
  }
}

function assertPercentage(percentage: number): void {
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    throw new Error("percentage must be greater than 0 and at most 100");
  }
}

const UPDATE_CODE_DISCOUNT = `
  mutation UpdateCodeDiscount($id: ID!, $input: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

export async function updateCodeDiscount(
  client: ShopifyClient,
  id: string,
  input: CodeDiscountUpdateInput,
): Promise<{ id: string }> {
  if (Object.values(input).every((value) => value === undefined)) {
    throw new Error("Provide at least one discount field to update");
  }
  const data = await client.query<{ discountCodeBasicUpdate: DiscountMutationPayload }>(
    UPDATE_CODE_DISCOUNT,
    { id, input },
  );
  return unwrapMutation(
    "discountCodeBasicUpdate",
    data.discountCodeBasicUpdate.codeDiscountNode,
    data.discountCodeBasicUpdate.userErrors,
  );
}

const DELETE_CODE_DISCOUNT = `
  mutation DeleteCodeDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors { field message }
    }
  }`;

export async function deleteCodeDiscount(client: ShopifyClient, id: string): Promise<{ id: string }> {
  const data = await client.query<{
    discountCodeDelete: { deletedCodeDiscountId: string | null; userErrors: UserError[] };
  }>(DELETE_CODE_DISCOUNT, { id });
  const deletedId = confirmDeletedId(
    "discountCodeDelete",
    id,
    data.discountCodeDelete.deletedCodeDiscountId,
    data.discountCodeDelete.userErrors,
  );
  return { id: deletedId };
}

const LIST_AUTOMATIC_DISCOUNTS = `
  query ListAutomaticDiscounts($first: Int!, $after: String) {
    automaticDiscountNodes(first: $first, after: $after) {
      nodes {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic { title summary status startsAt endsAt }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export async function listAutomaticDiscounts(
  client: ShopifyClient,
  first = 20,
  after?: string,
): Promise<AutomaticDiscountPage> {
  const data = await client.query<{ automaticDiscountNodes: AutomaticDiscountPage }>(
    LIST_AUTOMATIC_DISCOUNTS,
    { first, after },
  );
  return data.automaticDiscountNodes;
}

const CREATE_AUTOMATIC_DISCOUNT = `
  mutation CreateAutomaticDiscount($input: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

export async function createAutomaticDiscount(
  client: ShopifyClient,
  input: AutomaticDiscountCreateInput,
): Promise<{ id: string }> {
  const { value, ...options } = input;
  if (value.kind === "percentage") assertPercentage(value.percentage);
  if (value.kind === "fixedAmount") assertFixedAmount(value.amount);
  const discountValue = value.kind === "percentage"
    ? { percentage: value.percentage / 100 }
    : { discountAmount: { amount: value.amount, appliesOnEachItem: false } };
  const data = await client.query<{
    discountAutomaticBasicCreate: { automaticDiscountNode: { id: string } | null; userErrors: UserError[] };
  }>(CREATE_AUTOMATIC_DISCOUNT, {
    input: {
      ...options,
      context: { all: "ALL" },
      customerGets: { value: discountValue, items: { all: true } },
    },
  });
  return unwrapMutation(
    "discountAutomaticBasicCreate",
    data.discountAutomaticBasicCreate.automaticDiscountNode,
    data.discountAutomaticBasicCreate.userErrors,
  );
}

const UPDATE_AUTOMATIC_DISCOUNT = `
  mutation UpdateAutomaticDiscount($id: ID!, $input: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

export async function updateAutomaticDiscount(
  client: ShopifyClient,
  id: string,
  input: AutomaticDiscountUpdateInput,
): Promise<{ id: string }> {
  if (Object.values(input).every((value) => value === undefined)) {
    throw new Error("Provide at least one automatic discount field to update");
  }
  const data = await client.query<{
    discountAutomaticBasicUpdate: { automaticDiscountNode: { id: string } | null; userErrors: UserError[] };
  }>(UPDATE_AUTOMATIC_DISCOUNT, { id, input });
  return unwrapMutation(
    "discountAutomaticBasicUpdate",
    data.discountAutomaticBasicUpdate.automaticDiscountNode,
    data.discountAutomaticBasicUpdate.userErrors,
  );
}

const DELETE_AUTOMATIC_DISCOUNT = `
  mutation DeleteAutomaticDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }`;

export async function deleteAutomaticDiscount(
  client: ShopifyClient,
  id: string,
): Promise<{ id: string }> {
  const data = await client.query<{
    discountAutomaticDelete: { deletedAutomaticDiscountId: string | null; userErrors: UserError[] };
  }>(DELETE_AUTOMATIC_DISCOUNT, { id });
  const deletedId = confirmDeletedId(
    "discountAutomaticDelete",
    id,
    data.discountAutomaticDelete.deletedAutomaticDiscountId,
    data.discountAutomaticDelete.userErrors,
  );
  return { id: deletedId };
}
