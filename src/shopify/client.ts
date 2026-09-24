import type { ShopifyConfig } from "./config.js";
import type { TokenProvider } from "./auth/auth.js";
import { ShopifyGraphqlError } from "./errors.js";

const API_VERSION = "2026-07";
const HTTP_UNAUTHORIZED = 401;

interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlError[];
}

export class ShopifyClient {
  private readonly storeDomain: string;
  private readonly endpoint: string;

  constructor(
    config: ShopifyConfig,
    private readonly tokenProvider: TokenProvider,
  ) {
    this.storeDomain = config.storeDomain;
    this.endpoint = `https://${config.storeDomain}/admin/api/${API_VERSION}/graphql.json`;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ query, variables });
    let response = await this.send(body);
    if (response.status === HTTP_UNAUTHORIZED && this.tokenProvider.canRefresh) {
      this.tokenProvider.invalidate();
      response = await this.send(body);
    }
    return this.readData<T>(response);
  }

  private async send(body: string): Promise<Response> {
    try {
      return await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": await this.tokenProvider.getToken(),
        },
        body,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          `Could not reach ${this.storeDomain} — check the store domain and your internet connection.`,
        );
      }
      throw error;
    }
  }

  private async readData<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw new Error(`Shopify HTTP ${response.status}: ${await response.text()}`);
    }
    const result = (await response.json()) as GraphqlResponse<T>;
    if (result.errors?.length) {
      throw new ShopifyGraphqlError(
        result.errors.map((e) => e.message),
        result.errors.flatMap((e) => (e.extensions?.code ? [e.extensions.code] : [])),
      );
    }
    if (!result.data) throw new Error("Shopify returned no data");
    return result.data;
  }
}
