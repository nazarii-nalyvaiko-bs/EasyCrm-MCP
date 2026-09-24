import { type AppConfig, toAppEnv, toMaskedAppEnv } from "../app-config.js";
import { HoroshopClient } from "../horoshop/client.js";
import { listProducts } from "../horoshop/products.js";
import { PACKAGE_NAME, SERVER_NAME } from "../identity.js";
import { createTokenProvider } from "../shopify/auth/auth.js";
import { ShopifyClient } from "../shopify/client.js";
import type { ShopifyConfig } from "../shopify/config.js";
import { fetchShopInfo } from "../shopify/operations/shop.js";
import { standardServerEntry } from "./clients/launch.js";
import { createPrompter, type Prompter } from "./prompter.js";
import { askHoroshopConfig, askMcpClient, askShopifyConfig } from "./questions.js";

async function fetchShopName(config: ShopifyConfig): Promise<string> {
  const tokenProvider = createTokenProvider(config.storeDomain, config.auth);
  const client = new ShopifyClient(config, tokenProvider);
  return (await fetchShopInfo(client)).name;
}

function printManualConfig(config: AppConfig): void {
  console.log("Add this entry to your MCP client's config file:");
  console.log(JSON.stringify({ [SERVER_NAME]: standardServerEntry(toMaskedAppEnv(config)) }, null, 2));
}

async function wantsProvider(prompter: Prompter, label: string): Promise<boolean> {
  const answer = await prompter.ask(`Configure ${label}? [Y/n]: `);
  return !answer.toLowerCase().startsWith("n");
}

export async function runInitWizard(): Promise<void> {
  console.log(`${PACKAGE_NAME} setup — credentials stay on this machine.\n`);

  const prompter = createPrompter();
  try {
    const config: AppConfig = {};
    if (await wantsProvider(prompter, "Shopify")) {
      config.shopify = await askShopifyConfig(prompter);
      process.stdout.write(`Checking Shopify ${config.shopify.storeDomain}… `);
      const shopName = await fetchShopName(config.shopify);
      console.log(`✓ connected to "${shopName}"`);
    }
    if (await wantsProvider(prompter, "Horoshop")) {
      config.horoshop = await askHoroshopConfig(prompter);
      process.stdout.write(`Checking Horoshop ${config.horoshop.baseUrl}… `);
      await listProducts(new HoroshopClient(config.horoshop), { offset: 0, limit: 1 });
      console.log("✓ connected");
    }
    if (!config.shopify && !config.horoshop) {
      throw new Error("Configure at least one store to use this MCP server");
    }

    const client = await askMcpClient(prompter);
    if (!client) {
      printManualConfig(config);
      return;
    }

    const outcome = await client.register(toAppEnv(config));
    if (outcome.ok) {
      console.log(`✓ ${outcome.detail}`);
      console.log(`Restart ${client.label} (or reconnect the MCP server) to pick it up.`);
    } else {
      console.log(`Automatic registration failed: ${outcome.detail}`);
      printManualConfig(config);
    }
  } finally {
    prompter.close();
  }
}
