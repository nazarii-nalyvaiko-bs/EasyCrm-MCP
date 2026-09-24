import { type AuthConfig, type ShopifyConfig, normalizeStoreDomain } from "../shopify/config.js";
import { normalizeHoroshopUrl, type HoroshopConfig } from "../horoshop/config.js";
import { knownClients } from "./clients/index.js";
import type { McpClient } from "./clients/types.js";
import type { Prompter } from "./prompter.js";

function required(name: string, value: string): string {
  if (value === "") throw new Error(`${name} is required. Run init again.`);
  return value;
}

async function askAuthConfig(prompter: Prompter): Promise<AuthConfig> {
  const hasToken = await prompter.ask("Do you already have a permanent admin access token (shpat_…)? [y/N]: ");
  if (hasToken.toLowerCase().startsWith("y")) {
    const accessToken = required("Access token", await prompter.askSecret("Access token (hidden): "));
    return { mode: "accessToken", accessToken };
  }

  console.log("Using Dev Dashboard credentials for a store in your own Shopify organization.");
  const clientId = required("Client ID", await prompter.ask("Client ID: "));
  const clientSecret = required("Client Secret", await prompter.askSecret("Client Secret (hidden): "));
  return { mode: "clientCredentials", clientId, clientSecret };
}

export async function askShopifyConfig(prompter: Prompter): Promise<ShopifyConfig> {
  const storeDomain = normalizeStoreDomain(required(
    "Store domain",
    await prompter.ask("Store domain (my-store.myshopify.com): "),
  ));
  const auth = await askAuthConfig(prompter);
  return { storeDomain, auth };
}

export async function askHoroshopConfig(prompter: Prompter): Promise<HoroshopConfig> {
  const baseUrl = normalizeHoroshopUrl(required(
    "Horoshop store URL",
    await prompter.ask("Horoshop store URL (https://shop.example.com): "),
  ));
  const login = required("Horoshop API login", await prompter.ask("Horoshop API login: "));
  const password = required("Horoshop API password", await prompter.askSecret("Horoshop API password (hidden): "));
  return { baseUrl, login, password };
}

export async function askMcpClient(prompter: Prompter): Promise<McpClient | null> {
  const clients = knownClients();
  console.log("\nWhich AI client should use this server?");
  clients.forEach((client, index) => console.log(`  ${index + 1}) ${client.label}`));
  console.log(`  ${clients.length + 1}) Other — print the config to add manually`);

  while (true) {
    const answer = await prompter.ask(`Choose [1-${clients.length + 1}, default 1]: `);
    const choice = answer === "" ? 1 : Number.parseInt(answer, 10);
    if (Number.isInteger(choice) && choice >= 1 && choice <= clients.length + 1) {
      return choice <= clients.length ? clients[choice - 1] : null;
    }
  }
}
