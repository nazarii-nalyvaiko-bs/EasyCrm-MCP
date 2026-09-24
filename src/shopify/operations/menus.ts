import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";

interface MenuItem {
  id: string;
  title: string;
  type: string;
  url: string | null;
  items?: MenuItem[];
}

interface Menu {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
}

export interface MenuItemInput {
  id?: string;
  title: string;
  type: string;
  url?: string;
  resourceId?: string;
  items?: MenuItemInput[];
}

const LIST_MENUS_QUERY = `
  query ListMenus {
    menus(first: 10) {
      nodes {
        id
        handle
        title
        items {
          id
          title
          type
          url
          items { id title type url }
        }
      }
    }
  }`;

export async function listMenus(client: ShopifyClient): Promise<Menu[]> {
  const data = await client.query<{ menus: { nodes: Menu[] } }>(LIST_MENUS_QUERY);
  return data.menus.nodes;
}

const UPDATE_MENU_MUTATION = `
  mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu { id handle title items { id title type url } }
      userErrors { field message }
    }
  }`;

interface MenuMutationPayload {
  menu: Menu | null;
  userErrors: UserError[];
}

export async function updateMenu(
  client: ShopifyClient,
  id: string,
  title: string,
  items: MenuItemInput[],
): Promise<Menu> {
  const data = await client.query<{ menuUpdate: MenuMutationPayload }>(UPDATE_MENU_MUTATION, {
    id,
    title,
    items,
  });
  return unwrapMutation("menuUpdate", data.menuUpdate.menu, data.menuUpdate.userErrors);
}
