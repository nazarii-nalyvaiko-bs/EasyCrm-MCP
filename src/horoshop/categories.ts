import { z } from "zod";
import type { HoroshopClient } from "./client.js";

const categorySchema = z.object({
  id: z.number().int(),
  parent: z.number().int(),
  title: z.record(z.string(), z.string()),
}).passthrough();

export type HoroshopCategory = z.infer<typeof categorySchema>;

export async function listCategories(client: HoroshopClient, parent = 0): Promise<HoroshopCategory[]> {
  const result = await client.request("pages/export", { parent });
  if (result.status === "EMPTY") return [];
  if (result.status !== "OK") throw new Error(`Horoshop pages/export returned ${result.status}`);
  const response = result.response;
  if (!response || typeof response !== "object" || !("pages" in response)) {
    throw new Error("Horoshop pages/export returned no pages");
  }
  const parsed = z.array(categorySchema).safeParse(response.pages);
  if (!parsed.success) throw new Error("Horoshop pages/export returned invalid pages");
  return parsed.data;
}
