import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";

interface Page {
  id: string;
  title: string;
  handle: string;
  isPublished: boolean;
}

export interface PageCreateInput {
  title: string;
  handle?: string;
  body?: string;
  isPublished?: boolean;
}

export type PageUpdateInput = Partial<PageCreateInput>;

interface PageMutationPayload {
  page: Page | null;
  userErrors: UserError[];
}

const CREATE_PAGE_MUTATION = `
  mutation CreatePage($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id title handle isPublished }
      userErrors { field message }
    }
  }`;

export async function createPage(client: ShopifyClient, input: PageCreateInput): Promise<Page> {
  const data = await client.query<{ pageCreate: PageMutationPayload }>(CREATE_PAGE_MUTATION, {
    page: input,
  });
  return unwrapMutation("pageCreate", data.pageCreate.page, data.pageCreate.userErrors);
}

const UPDATE_PAGE_MUTATION = `
  mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id title handle isPublished }
      userErrors { field message }
    }
  }`;

export async function updatePage(
  client: ShopifyClient,
  id: string,
  input: PageUpdateInput,
): Promise<Page> {
  const data = await client.query<{ pageUpdate: PageMutationPayload }>(UPDATE_PAGE_MUTATION, {
    id,
    page: input,
  });
  return unwrapMutation("pageUpdate", data.pageUpdate.page, data.pageUpdate.userErrors);
}

const LIST_PAGES_QUERY = `
  query ListPages {
    pages(first: 20) {
      nodes { id title handle isPublished }
    }
  }`;

export async function listPages(client: ShopifyClient): Promise<Page[]> {
  const data = await client.query<{ pages: { nodes: Page[] } }>(LIST_PAGES_QUERY);
  return data.pages.nodes;
}
