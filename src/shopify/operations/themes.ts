import type { ShopifyClient } from "../client.js";
import { ShopifyUserError, type UserError } from "../errors.js";

export type ThemeRole = "ARCHIVED" | "DEMO" | "DEVELOPMENT" | "LOCKED" | "MAIN" | "UNPUBLISHED" | "MOBILE";

interface Theme {
  id: string;
  name: string;
  role: ThemeRole;
}

const LIST_THEMES_QUERY = `
  query ListThemes {
    themes(first: 10) {
      nodes { id name role }
    }
  }`;

export async function listThemes(client: ShopifyClient): Promise<Theme[]> {
  const data = await client.query<{ themes: { nodes: Theme[] } }>(LIST_THEMES_QUERY);
  return data.themes.nodes;
}

interface UpdateThemeFileInput {
  themeId: string;
  filePath: string;
  fileContent: string;
  expectedRole: ThemeRole;
  confirmLiveTheme?: boolean;
}

const UPDATE_THEME_FILE_MUTATION = `
  mutation UpdateThemeFile($themeId: ID!, $filePath: String!, $fileContent: String!) {
    themeFilesUpsert(
      themeId: $themeId
      files: [{ filename: $filePath, body: { type: TEXT, value: $fileContent } }]
    ) {
      upsertedThemeFiles { filename }
      job { id }
      userErrors { field message }
    }
  }`;

interface ThemeFilesUpsertPayload {
  upsertedThemeFiles: { filename: string }[] | null;
  job: { id: string } | null;
  userErrors: UserError[];
}

export async function updateThemeFile(
  client: ShopifyClient,
  input: UpdateThemeFileInput,
): Promise<{ filename: string; jobId: string | null }> {
  const current = await client.query<{ theme: Theme | null }>(
    `query ThemeRoleBeforeUpdate($id: ID!) { theme(id: $id) { id name role } }`,
    { id: input.themeId },
  );
  if (!current.theme) throw new Error(`Theme ${input.themeId} was not found`);
  if (current.theme.role !== input.expectedRole) {
    throw new Error(`Theme ${current.theme.name} is now ${current.theme.role}, expected ${input.expectedRole}. Review the active theme before editing.`);
  }
  if (current.theme.role === "MAIN" && input.confirmLiveTheme !== true) {
    throw new Error(`Theme ${current.theme.name} is the active live theme. Ask the user before editing it, then set confirmLiveTheme to true.`);
  }
  const data = await client.query<{ themeFilesUpsert: ThemeFilesUpsertPayload }>(
    UPDATE_THEME_FILE_MUTATION,
    { themeId: input.themeId, filePath: input.filePath, fileContent: input.fileContent },
  );
  const { upsertedThemeFiles, job, userErrors } = data.themeFilesUpsert;
  if (userErrors.length > 0) throw new ShopifyUserError("themeFilesUpsert", userErrors);
  const filename = upsertedThemeFiles?.[0]?.filename;
  if (filename && filename !== input.filePath) {
    throw new Error(`Shopify confirmed ${filename} instead of ${input.filePath}`);
  }
  if (!filename && !job?.id) throw new Error("Shopify did not confirm the theme file update");
  return {
    filename: filename ?? input.filePath,
    jobId: job?.id ?? null,
  };
}

const READ_THEME_FILE_QUERY = `
  query ReadThemeFile($themeId: ID!, $filePath: String!) {
    theme(id: $themeId) {
      files(filenames: [$filePath], first: 1) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
          }
        }
      }
    }
  }`;

interface ReadThemeFileResponse {
  theme: {
    files: {
      nodes: { filename: string; body: { content: string | null } | null }[];
    };
  } | null;
}

export async function readThemeFile(
  client: ShopifyClient,
  themeId: string,
  filePath: string,
): Promise<string> {
  const data = await client.query<ReadThemeFileResponse>(READ_THEME_FILE_QUERY, { themeId, filePath });

  if (!data.theme) throw new Error(`Theme with ID ${themeId} not found`);

  const file = data.theme.files.nodes[0];
  if (!file) throw new Error(`File ${filePath} not found in theme ${themeId}`);

  const content = file.body?.content;
  if (content == null) throw new Error(`File ${filePath} in theme ${themeId} has no content`);

  return content;
}
