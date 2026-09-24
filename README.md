# EasyCRM MCP

An MCP server for managing one Shopify store and one Horoshop store. Shopify tools manage themes, pages, and menus. The first Horoshop tool reads products; order, stock, and content tools can be added as separate provider modules.

The server runs locally and sends requests directly to each configured platform. Credentials stay in your MCP client configuration on your machine.

## Shopify demo


https://github.com/user-attachments/assets/afd71d46-e8d7-4c06-96dc-094cae3fe5a2


## Quick start

https://github.com/user-attachments/assets/175e5051-b6ec-4201-a33e-d27c68356171

```bash
npx -y easycrm-mcp init
```

The wizard lets you configure Shopify, Horoshop, or both. It verifies each connection and registers the server in the client you pick:

- Claude Code
- Codex CLI
- Gemini CLI
- Claude Desktop
- Cursor
- Windsurf
- VS Code (Copilot)

Pick "Other" to print a config entry for any other MCP client.

## Store credentials

### Shopify

You need a store on a plan with Admin API access and one of:

**Option A: Dev Dashboard app (for stores in your own Shopify organization)**

1. Go to [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard) and create an app for a store in your organization. [Shopify limits client credentials to stores in your own organization](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens).
2. Grant it the scopes: `read_themes`, `write_themes`, `read_content`, `write_content`, `read_online_store_navigation`, `write_online_store_navigation`.
3. Copy the Client ID and Client Secret from the app's settings.

**Option B: existing admin access token**

Use an existing `shpat_…` token from an admin-created custom app. Shopify no longer allows creating new admin-created custom apps.

Editing theme files requires Shopify's `write_themes` exemption in addition to the API scope. See [Shopify's themeFilesUpsert requirements](https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert).

### Horoshop

Create a dedicated API admin login in the Horoshop admin panel under Settings > Admins. Configure the store's HTTPS origin, login, and password. Horoshop issues an API token valid for 600 seconds; this server renews it automatically. See the [official Horoshop API documentation](https://horoshop.notion.site/api-doc) and [authentication details](https://horoshop.notion.site/1b6cc289707981b4bc0fc160b2b5fdf4).

## Manual configuration

If you skip the wizard, add this to your MCP client's config:

```json
{
  "easycrm": {
    "command": "npx",
    "args": ["-y", "easycrm-mcp"],
    "env": {
      "SHOPIFY_STORE_DOMAIN": "your-store.myshopify.com",
      "SHOPIFY_CLIENT_ID": "…",
      "SHOPIFY_CLIENT_SECRET": "…",
      "HOROSHOP_STORE_URL": "https://shop.example.com",
      "HOROSHOP_LOGIN": "your_api_login",
      "HOROSHOP_PASSWORD": "…"
    }
  }
}
```

You can configure either platform by omitting the other platform's variables. For Shopify, you can use an existing access token instead of client credentials by setting `SHOPIFY_ADMIN_ACCESS_TOKEN`.

## Tools

| Tool | What it does |
|------|--------------|
| `shopify_get_info` | Read Shopify store name, domain, plan, currency |
| `shopify_theme_list` | List Shopify themes |
| `shopify_theme_read_file` | Read a Shopify theme file |
| `shopify_theme_update_file` | Create or update a Shopify theme file |
| `shopify_page_list` | List Shopify pages |
| `shopify_page_create` | Create a Shopify page |
| `shopify_page_update` | Update a Shopify page |
| `shopify_menu_list` | List Shopify menus |
| `shopify_menu_update` | Replace a Shopify menu |
| `horoshop_product_list` | Read Horoshop products, optionally filtered by article (SKU) |

Each tool is tied to one configured platform. The Horoshop product tool supports `offset` and `limit` for paging, with a maximum of 500 products per request per the [Horoshop export API](https://horoshop.notion.site/1b6cc289707981e782b6e7c57c2fa526).

## Moving from the Shopify-only package

The previously published `shopify-store-builder-mcp` package remains available. To use this package, replace the npm command with `easycrm-mcp`, use the new `easycrm` MCP entry, and update tool names to their `shopify_` versions. Horoshop variables can then be added to the same entry.

## Development

```bash
npm install
npm run dev     # run from source
npm run build   # compile to dist/
npm test
npm audit
```

## License

ISC
