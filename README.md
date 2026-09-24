# EasyCRM MCP

An MCP server for one Shopify store and one Horoshop store. Tools are grouped by platform and resource so each action has a clear destination and input contract.

The server runs locally and sends requests directly to each configured platform. Credentials stay in your MCP client configuration on your machine.

## Quick start

https://github.com/user-attachments/assets/175e5051-b6ec-4201-a33e-d27c68356171

```bash
npx -y easycrm-mcp init
```

The renamed npm package is not published yet. Until it is published, run `npm install` and `npm run dev -- init` from this repository.

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
2. Grant only the scopes needed for the tools you plan to use:

   | Resource | Read | Write |
   |----------|------|-------|
   | Themes | `read_themes` | `write_themes` |
   | Pages | `read_content` | `write_content` |
   | Menus | `read_online_store_navigation` | `write_online_store_navigation` |
   | Products and variants | `read_products` | `write_products` |
   | Inventory | `read_inventory`, `read_locations` | `write_inventory` |
   | Customers | `read_customers` | `write_customers` |
   | Orders | `read_orders` | `write_orders` |
   | Fulfillment orders | Matching assigned, merchant-managed, or third-party fulfillment read scope | Matching fulfillment write scope |
   | Discounts | `read_discounts` | `write_discounts` |
   | Native sales reports | `read_reports` | None |

   Shopify customer data also requires protected customer data approval. Orders older than 60 days normally require `read_all_orders`. Some actions require additional staff permissions or an offline token. The individual tool descriptions state these cases.
   The native Shopify sales report requires Level 2 protected customer data access, as documented for `shopifyqlQuery`.
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

### Shopify

| Tool | What it does |
|------|--------------|
| `shopify_get_info` | Read Shopify store name, domain, plan, currency |
| `shopify_theme_list` | List Shopify themes |
| `shopify_theme_active` | Identify the current live MAIN theme |
| `shopify_theme_import_draft` | Import a theme ZIP as unpublished |
| `shopify_theme_duplicate_draft` | Copy an existing theme into an unpublished draft |
| `shopify_theme_publish` | Publish a theme after confirming the current MAIN theme and user approval |
| `shopify_theme_read_file` | Read a Shopify theme file |
| `shopify_theme_update_file` | Create or update a theme file, with a live-theme guard |
| `shopify_page_list` | List Shopify pages |
| `shopify_page_create` | Create a Shopify page |
| `shopify_page_update` | Update a Shopify page |
| `shopify_menu_list` | List Shopify menus |
| `shopify_menu_update` | Replace a Shopify menu |
| `shopify_product_list/get/create/update/delete` | Manage core product fields |
| `shopify_product_create_draft_with_images` | Create an unpublished product and submit image URLs, optionally setting its first price |
| `shopify_product_image_add` | Add images to an existing product |
| `shopify_product_media_list` | Check image processing status and URLs |
| `shopify_product_variant_list/update_price` | Read variants and change a price |
| `shopify_inventory_location_list` | Find inventory locations |
| `shopify_product_variant_inventory` | Read available quantity by location |
| `shopify_inventory_set_available` | Set available quantity with a comparison value and idempotency key |
| `shopify_customer_list/get/create/update/delete` | Manage customer profiles |
| `shopify_order_list/get/create/update/delete/cancel` | Manage orders within Shopify's operation rules |
| `shopify_order_fulfillment_orders` | Find fulfillable units for an order |
| `shopify_fulfillment_create` | Fulfill one entire fulfillment order |
| `shopify_order_summary` | Compute a bounded order summary from accessible orders |
| `shopify_sales_report` | Read native Shopify Analytics sales metrics by day, month, or total |
| `shopify_discount_code_list/create/create_fixed/update/delete` | Manage basic code discounts by percentage or fixed amount |
| `shopify_discount_automatic_list/create/update/delete` | Manage basic automatic discounts |

### Horoshop

| Tool | What it does |
|------|--------------|
| `horoshop_category_list` | Read child categories under a parent |
| `horoshop_product_list` | Read products, optionally filtered by article (SKU) |
| `horoshop_product_create` | Create a product in a selected category with optional images |
| `horoshop_product_update` | Update an existing product's price, text, visibility, warehouse stock, or images |
| `horoshop_customer_upsert` | Create or update one customer by email |
| `horoshop_order_list` | Read paged orders with optional date and status filters |
| `horoshop_order_statuses` | Read configured order status IDs |
| `horoshop_order_update` | Set one order's status or payment flag |
| `horoshop_order_summary` | Compute bounded counts and totals from orders in a date range |

Each tool is tied to one configured platform. Horoshop product creation accepts image URLs for a variant gallery or a shared gallery. Image updates require an explicit append or replace mode; replace removes the existing images in that gallery. Horoshop fetches images from the supplied URLs, with a 5 MB limit for each source image. The product list supports `offset` and `limit` for paging, with a maximum of 500 products per request per the [Horoshop export API](https://horoshop.notion.site/1b6cc289707981e782b6e7c57c2fa526). Horoshop category export requires platform version 4 or later.

Before editing theme files, call `shopify_theme_active` or `shopify_theme_list`. The update tool checks the observed role again. Editing the live MAIN theme requires explicit user approval and `confirmLiveTheme: true`; publishing requires approval, `confirmPublish: true`, and the expected current MAIN theme ID. Draft themes can be edited without changing the live storefront. Shopify requires a [theme API exemption](https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeDuplicate) for theme mutations.

Shopify product images are submitted from public HTTPS URLs. Shopify processes them asynchronously, so use `shopify_product_media_list` to check readiness. Creating a draft with an initial price uses a second mutation for the default variant. If that step fails, the tool returns the created product ID and marks the partial result as an error.

### Analytics

- `shopify_sales_report` reads native Shopify Analytics through [ShopifyQL](https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery). Select a date range, total/daily/monthly interval, and metrics such as sales, orders, discounts, and average order value. This requires `read_reports` and Level 2 protected customer data access.
- `shopify_order_summary` calculates order counts and current order totals from accessible orders. It reports `paginationComplete` and a cursor when it stops before the last page.
- `horoshop_order_summary` calculates order counts, paid counts, totals by currency, and breakdowns by status and UTM source from the [Horoshop orders API](https://horoshop.notion.site/1b6cc28970798113b9b3fbd6fe844076). Currency totals are exact decimal strings, for example `"0.3"`. It scans at most 5,000 orders and reports `complete: false` if more may exist.

The two order summaries are calculated from API orders, not native analytics reports or settled payment revenue. Horoshop `total_sum` includes discounts and excludes shipping. The server does not currently expose traffic, sessions, or conversion funnel analytics for Horoshop.

The current tools do not cover every action in either admin. In particular, Shopify refunds, partial fulfillment, edits to line items, advanced discount types, and Horoshop customer deletion or order creation/deletion need separate workflows and API verification. Shopify cancellation returns a job ID because processing is asynchronous. See [the architecture notes](docs/architecture.md) for the extension plan.

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
