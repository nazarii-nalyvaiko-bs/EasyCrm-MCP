import { z } from "zod";
import type { AuthConfig } from "../config.js";

export interface TokenProvider {
  readonly canRefresh: boolean;
  getToken(): Promise<string>;
  invalidate(): void;
}

export class StaticTokenProvider implements TokenProvider {
  readonly canRefresh = false;

  constructor(private readonly accessToken: string) {}

  async getToken(): Promise<string> {
    return this.accessToken;
  }

  invalidate(): void {}
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

export class CredentialExchangeError extends Error {
  constructor(readonly status: number) {
    super(`Shopify rejected the credential exchange (HTTP ${status})`);
    this.name = "CredentialExchangeError";
  }
}

interface IssuedToken {
  token: string;
  expiresAt: number;
}

const accessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().finite().positive(),
});

const MILLISECONDS_PER_SECOND = 1_000;

async function exchangeClientCredentials(
  storeDomain: string,
  credentials: ClientCredentials,
): Promise<IssuedToken> {
  const response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });
  if (!response.ok) throw new CredentialExchangeError(response.status);

  const parsed = accessTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Shopify returned an invalid credential exchange response");
  }
  return {
    token: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * MILLISECONDS_PER_SECOND,
  };
}

const REFRESH_BUFFER_MS = 60_000;

export class ClientCredentialsTokenProvider implements TokenProvider {
  readonly canRefresh = true;

  private issued: IssuedToken | null = null;
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly storeDomain: string,
    private readonly credentials: ClientCredentials,
  ) {}

  async getToken(): Promise<string> {
    return this.freshToken() ?? this.refresh();
  }

  invalidate(): void {
    this.issued = null;
  }

  private freshToken(): string | null {
    if (!this.issued) return null;
    const isFresh = Date.now() < this.issued.expiresAt - REFRESH_BUFFER_MS;
    return isFresh ? this.issued.token : null;
  }

  private refresh(): Promise<string> {
    this.refreshInFlight ??= exchangeClientCredentials(this.storeDomain, this.credentials)
      .then((issued) => {
        this.issued = issued;
        return issued.token;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }
}

export function createTokenProvider(storeDomain: string, auth: AuthConfig): TokenProvider {
  if (auth.mode === "accessToken") return new StaticTokenProvider(auth.accessToken);
  return new ClientCredentialsTokenProvider(storeDomain, auth);
}
