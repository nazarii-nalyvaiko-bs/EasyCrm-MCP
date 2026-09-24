import { z } from "zod";
import type { HoroshopConfig } from "./config.js";

const apiEnvelopeSchema = z.object({
  status: z.string().min(1),
  response: z.unknown().optional(),
});
const authResponseSchema = z.object({ token: z.string().min(1) });
const errorResponseSchema = z.object({ message: z.string() });

type ApiEnvelope = z.infer<typeof apiEnvelopeSchema>;

export type HoroshopOperation =
  | "catalog/export"
  | "catalog/import"
  | "pages/export"
  | "users/import"
  | "orders/get"
  | "orders/get_available_statuses"
  | "orders/update";

function responseMessage(response: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(response);
  return parsed.success ? parsed.data.message : undefined;
}

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

  async request(operation: HoroshopOperation, parameters: Record<string, unknown> = {}): Promise<ApiEnvelope> {
    const payload = { ...parameters, token: await this.getToken() };
    let result = await this.post(operation, payload);
    if (result.status === "UNAUTHORIZED") {
      this.invalidateToken();
      result = await this.post(operation, { ...parameters, token: await this.getToken() });
    }
    if (result.status !== "OK" && result.status !== "EMPTY" && result.status !== "WARNING") {
      throw new HoroshopApiError(operation, result.status, responseMessage(result.response));
    }
    return result;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.token;
    }
    this.authInFlight ??= this.post("auth", {
      login: this.config.login,
      password: this.config.password,
    })
      .then((result) => {
        const auth = authResponseSchema.safeParse(result.response);
        if (result.status !== "OK" || !auth.success) {
          throw new HoroshopApiError("auth", result.status, responseMessage(result.response));
        }
        this.token = auth.data.token;
        this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
        return auth.data.token;
      })
      .finally(() => { this.authInFlight = null; });
    return this.authInFlight;
  }

  private invalidateToken(): void {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  private async post(operation: HoroshopOperation | "auth", payload: Record<string, unknown>): Promise<ApiEnvelope> {
    const response = await fetch(`${this.config.baseUrl}/api/${operation}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new HoroshopApiError(operation, `HTTP ${response.status}`);
    const result = apiEnvelopeSchema.safeParse(await response.json());
    if (!result.success) {
      throw new HoroshopApiError(operation, "INVALID_RESPONSE");
    }
    return result.data;
  }
}
