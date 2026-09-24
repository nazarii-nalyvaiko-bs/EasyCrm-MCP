export interface HoroshopConfig {
  baseUrl: string;
  login: string;
  password: string;
}

export function normalizeHoroshopUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("HOROSHOP_STORE_URL must be a full HTTPS URL, for example https://shop.example.com");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("HOROSHOP_STORE_URL must be an HTTPS store origin without credentials, port, path, query, or fragment");
  }
  return url.origin;
}

export function loadHoroshopConfig(): HoroshopConfig {
  const storeUrl = process.env.HOROSHOP_STORE_URL;
  const login = process.env.HOROSHOP_LOGIN;
  const password = process.env.HOROSHOP_PASSWORD;
  if (!storeUrl || !login || !password) {
    throw new Error("Set HOROSHOP_STORE_URL, HOROSHOP_LOGIN, and HOROSHOP_PASSWORD together");
  }
  return { baseUrl: normalizeHoroshopUrl(storeUrl), login, password };
}

export function toHoroshopEnv(config: HoroshopConfig): Record<string, string> {
  return {
    HOROSHOP_STORE_URL: config.baseUrl,
    HOROSHOP_LOGIN: config.login,
    HOROSHOP_PASSWORD: config.password,
  };
}

export function toMaskedHoroshopEnv(config: HoroshopConfig): Record<string, string> {
  return {
    ...toHoroshopEnv(config),
    HOROSHOP_LOGIN: "<paste the real value here>",
    HOROSHOP_PASSWORD: "<paste the real value here>",
  };
}
