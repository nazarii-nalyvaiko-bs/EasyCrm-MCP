import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { confirmDeletedId, unwrapMutation } from "./mutation.js";

export interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
  createdAt: string;
}

export interface CustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  note?: string;
  tags?: string[];
}

export interface CustomerPage {
  nodes: Customer[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface CustomerMutationPayload {
  customer: Customer | null;
  userErrors: UserError[];
}

const CUSTOMER_FIELDS = "id firstName lastName email phone note tags createdAt";

export async function listCustomers(
  client: ShopifyClient,
  input: { first: number; after?: string; query?: string },
): Promise<CustomerPage> {
  const data = await client.query<{ customers: CustomerPage }>(
    `query ListCustomers($first: Int!, $after: String, $query: String) {
      customers(first: $first, after: $after, query: $query) {
        nodes { ${CUSTOMER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    input,
  );
  return data.customers;
}

export async function getCustomer(client: ShopifyClient, id: string): Promise<Customer | null> {
  const data = await client.query<{ customer: Customer | null }>(
    `query GetCustomer($id: ID!) { customer(id: $id) { ${CUSTOMER_FIELDS} } }`,
    { id },
  );
  return data.customer;
}

export async function createCustomer(client: ShopifyClient, input: CustomerInput): Promise<Customer> {
  const data = await client.query<{ customerCreate: CustomerMutationPayload }>(
    `mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { ${CUSTOMER_FIELDS} }
        userErrors { field message }
      }
    }`,
    { input },
  );
  return unwrapMutation("customerCreate", data.customerCreate.customer, data.customerCreate.userErrors);
}

export async function updateCustomer(
  client: ShopifyClient,
  id: string,
  changes: CustomerInput,
): Promise<Customer> {
  const data = await client.query<{ customerUpdate: CustomerMutationPayload }>(
    `mutation UpdateCustomer($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { ${CUSTOMER_FIELDS} }
        userErrors { field message }
      }
    }`,
    { input: { id, ...changes } },
  );
  return unwrapMutation("customerUpdate", data.customerUpdate.customer, data.customerUpdate.userErrors);
}

export async function deleteCustomer(
  client: ShopifyClient,
  id: string,
): Promise<{ deletedCustomerId: string }> {
  const data = await client.query<{
    customerDelete: { deletedCustomerId: string | null; userErrors: UserError[] };
  }>(
    `mutation DeleteCustomer($id: ID!) {
      customerDelete(input: { id: $id }) {
        deletedCustomerId
        userErrors { field message }
      }
    }`,
    { id },
  );
  return {
    deletedCustomerId: confirmDeletedId(
      "customerDelete",
      id,
      data.customerDelete.deletedCustomerId,
      data.customerDelete.userErrors,
    ),
  };
}
