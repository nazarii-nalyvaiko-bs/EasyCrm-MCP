import { z } from "zod";
import type { HoroshopClient } from "./client.js";
import { listOrders } from "./orders.js";

const itemSchema = z.object({
  title: z.string(),
  article: z.string().nullish(),
  quantity: z.number().int().nonnegative(),
  price: z.union([z.number().finite().transform(String), z.string()]).optional(),
});
const historyOrderSchema = z.object({
  order_id: z.number().int(),
  stat_created: z.string().optional(),
  stat_status: z.number().int().optional(),
  payed: z.union([z.literal(0), z.literal(1)]).optional(),
  total_sum: z.string().optional(),
  currency: z.string().optional(),
  products: z.array(itemSchema),
});

export interface PurchaseHistoryInput {
  email: string;
  offset: number;
  maxPages: number;
  from?: string;
  to?: string;
}

/** Horoshop has no documented customer filter for orders/get, so scan bounded pages. */
export async function getPurchaseHistory(client: HoroshopClient, input: PurchaseHistoryInput) {
  const orders: z.infer<typeof historyOrderSchema>[] = [];
  const email = input.email.toLowerCase();
  const pageSize = 100;
  let scannedOrders = 0;
  let complete = false;

  for (let page = 0; page < input.maxPages; page += 1) {
    const batch = await listOrders(client, {
      from: input.from,
      to: input.to,
      offset: input.offset + scannedOrders,
      limit: pageSize,
    });
    scannedOrders += batch.length;
    for (const order of batch) {
      if (typeof order.delivery_email !== "string" || order.delivery_email.toLowerCase() !== email) continue;
      const parsed = historyOrderSchema.safeParse(order);
      if (!parsed.success) throw new Error(`Horoshop order ${order.order_id} has invalid purchase history data`);
      orders.push(parsed.data);
    }
    if (batch.length < pageSize) {
      complete = true;
      break;
    }
  }

  return {
    email: input.email,
    orders,
    scannedOrders,
    complete,
    nextOffset: complete ? null : input.offset + scannedOrders,
  };
}
