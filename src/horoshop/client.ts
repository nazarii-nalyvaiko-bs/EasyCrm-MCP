import type { HoroshopConfig } from "./config.js";

interface ApiEnvelope<T> {
  status: string;
  response?: T & { message?: string };
}

type HoroshopOperation = "catalog/export";

export class HoroshopApiError extends Error {
  constructor(operation: string, status: string, detail?: string) {
    super(`Horoshop ${operation} failed (${status})${detail ? `: ${detail}` : ""}`);
    this.name = "HoroshopApiError";
  }
}

const TOKEN_LIFETIME_MS = 600_000;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class HoroshopClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private authInFlight: Promise<string> | null = null;

  constructor(private readonly config: HoroshopConfig) {}

  async request<T>(operation: HoroshopOperation, parameters: Record<string, unknown> = {}): Promise<T | null> {
    const payload = { ...parameters, token: await this.getToken() };
    let result = await this.post<T>(operation, payload);
    if (result.status === "UNAUTHORIZED") {
      this.invalidateToken();
      result = await this.post<T>(operation, { ...parameters, token: await this.getToken() });
    }
    if (result.status === "EMPTY") return null;
    if (result.status !== "OK" || !result.response) {
      throw new HoroshopApiError(operation, result.status, result.response?.message);
    }
    return result.response;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.token;
    }
    this.authInFlight ??= this.post<{ token: string }>("auth", {
      login: this.config.login,
      password: this.config.password,
    })
      .then((result) => {
        if (result.status !== "OK" || !result.response?.token) {
          throw new HoroshopApiError("auth", result.status, result.response?.message);
        }
        this.token = result.response.token;
        this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
        return this.token;
      })
      .finally(() => { this.authInFlight = null; });
    return this.authInFlight;
  }

  private invalidateToken(): void {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  private async post<T>(operation: string, payload: Record<string, unknown>): Promise<ApiEnvelope<T>> {
    const response = await fetch(`${this.config.baseUrl}/api/${operation}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new HoroshopApiError(operation, `HTTP ${response.status}`);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("status" in result) || typeof result.status !== "string") {
      throw new HoroshopApiError(operation, "INVALID_RESPONSE");
    }
    return result as ApiEnvelope<T>;
  }
}
