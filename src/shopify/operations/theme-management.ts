import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import type { ThemeRole } from "./themes.js";
import { unwrapMutation } from "./mutation.js";

export interface ManagedTheme {
  id: string;
  name: string;
  role: ThemeRole;
  processing: boolean;
  processingFailed: boolean;
}

interface ThemePayload {
  theme: ManagedTheme | null;
  userErrors: UserError[];
}

interface DuplicateThemePayload {
  newTheme: ManagedTheme | null;
  userErrors: UserError[];
}

const THEME_FIELDS = "id name role processing processingFailed";

const ACTIVE_THEME = `
  query ActiveTheme {
    themes(first: 2, roles: [MAIN]) {
      nodes { ${THEME_FIELDS} }
    }
  }`;

/** Read the theme currently visible to customers. */
export async function getActiveTheme(client: ShopifyClient): Promise<ManagedTheme> {
  const data = await client.query<{ themes: { nodes: ManagedTheme[] } }>(ACTIVE_THEME);
  const themes = data.themes.nodes;
  if (themes.length !== 1 || themes[0]?.role !== "MAIN") {
    throw new Error("Shopify did not return exactly one active MAIN theme");
  }
  return themes[0];
}

const CREATE_THEME = `
  mutation CreateUnpublishedTheme($source: URL!, $name: String!) {
    themeCreate(source: $source, name: $name, role: UNPUBLISHED) {
      theme { ${THEME_FIELDS} }
      userErrors { field message }
    }
  }`;

/** Import a theme ZIP as an unpublished theme. This does not affect the live storefront. */
export async function createUnpublishedTheme(
  client: ShopifyClient,
  source: string,
  name: string,
): Promise<ManagedTheme> {
  const data = await client.query<{ themeCreate: ThemePayload }>(CREATE_THEME, { source, name });
  return confirmUnpublished("themeCreate", data.themeCreate.theme, data.themeCreate.userErrors);
}

const DUPLICATE_THEME = `
  mutation DuplicateTheme($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme { ${THEME_FIELDS} }
      userErrors { field message }
    }
  }`;

/** Duplicate an existing theme and verify that Shopify returned an unpublished copy. */
export async function duplicateUnpublishedTheme(
  client: ShopifyClient,
  sourceThemeId: string,
  name?: string,
): Promise<ManagedTheme> {
  const data = await client.query<{ themeDuplicate: DuplicateThemePayload }>(DUPLICATE_THEME, {
    id: sourceThemeId,
    ...(name ? { name } : {}),
  });
  return confirmUnpublished("themeDuplicate", data.themeDuplicate.newTheme, data.themeDuplicate.userErrors);
}

function confirmUnpublished(
  operation: string,
  theme: ManagedTheme | null,
  userErrors: UserError[],
): ManagedTheme {
  const created = unwrapMutation(operation, theme, userErrors);
  if (created.role !== "UNPUBLISHED") {
    throw new Error(`${operation} returned theme ${created.id} with unexpected role ${created.role}`);
  }
  return created;
}

const PUBLISH_THEME = `
  mutation PublishTheme($id: ID!) {
    themePublish(id: $id) {
      theme { ${THEME_FIELDS} }
      userErrors { field message }
    }
  }`;

/** Make one existing theme live on the storefront. */
export async function publishTheme(
  client: ShopifyClient,
  themeId: string,
  expectedCurrentMainThemeId: string,
): Promise<ManagedTheme> {
  if (themeId === expectedCurrentMainThemeId) {
    throw new Error("The requested theme is already the expected active theme");
  }
  const current = await getActiveTheme(client);
  if (current.id !== expectedCurrentMainThemeId) {
    throw new Error(`Active theme changed from ${expectedCurrentMainThemeId} to ${current.id}; refresh before publishing`);
  }
  const data = await client.query<{ themePublish: ThemePayload }>(PUBLISH_THEME, { id: themeId });
  const published = unwrapMutation("themePublish", data.themePublish.theme, data.themePublish.userErrors);
  if (published.id !== themeId || published.role !== "MAIN") {
    throw new Error(`themePublish did not confirm ${themeId} as the live theme`);
  }
  return published;
}
