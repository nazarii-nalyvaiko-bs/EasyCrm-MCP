import { z } from "zod";
import { addDecimal } from "../money.js";
import type { HoroshopClient } from "./client.js";

const decimalAmount = z.string().regex(/^-?\d+(?:\.\d+)?$/);

const orderSchema = z.object({
  order_id: z.number().int(),
  stat_status: z.number().int().optional(),
  stat_created: z.string().optional(),
  total_sum: z.union([
    z.number().finite().transform(String).pipe(decimalAmount),
    decimalAmount,
  ]).optional(),
  currency: z.string().min(1).optional(),
  payed: z.union([z.literal(0), z.literal(1)]).optional(),
  analytics: z.object({ utm_source: z.string().nullish() }).passthrough().nullish(),
}).passthrough();

const statusSchema = z.object({
  id: z.number().int(),
  title: z.record(z.string(), z.string()).optional(),
  is_successful: z.union([z.literal(0), z.literal(1)]),
}).passthrough();

export type HoroshopOrder = z.infer<typeof orderSchema>;
export type HoroshopOrderStatus = z.infer<typeof statusSchema>;

export interface OrderFilter {
  from?: string;
  to?: string;
  status?: number;
  offset: number;
  limit: number;
}

function responseField(response: unknown, field: string): unknown {
  const parsed = z.record(z.string(), z.unknown()).safeParse(response);
  if (!parsed.success || !Object.hasOwn(parsed.data, field)) {
    throw new Error(`Horoshop response is missing ${field}`);
  }
  return parsed.data[field];
}

export async function listOrders(client: HoroshopClient, filter: OrderFilter): Promise<HoroshopOrder[]> {
  const result = await client.request("orders/get", {
    offset: filter.offset,
    limit: filter.limit,
    ...(filter.from && { from: filter.from }),
    ...(filter.to && { to: filter.to }),
    ...(filter.status !== undefined && { status: filter.status }),
  });
  if (result.status === "EMPTY") return [];
  if (result.status !== "OK") throw new Error(`Horoshop orders/get returned ${result.status}`);
  const parsed = z.array(orderSchema).safeParse(responseField(result.response, "orders"));
  if (!parsed.success) throw new Error("Horoshop orders/get returned invalid orders");
  return parsed.data;
}

export async function listOrderStatuses(client: HoroshopClient): Promise<HoroshopOrderStatus[]> {
  const result = await client.request("orders/get_available_statuses");
  if (result.status !== "OK") throw new Error(`Horoshop order statuses returned ${result.status}`);
  const parsed = z.record(z.string(), statusSchema).safeParse(responseField(result.response, "statuses"));
  if (!parsed.success) throw new Error("Horoshop returned invalid order statuses");
  return Object.values(parsed.data);
}

export interface OrderUpdate {
  orderId: number;
  status?: number;
  paid?: boolean;
}

export async function updateOrder(client: HoroshopClient, update: OrderUpdate): Promise<{ orderId: number; updated: true }> {
  if (update.status === undefined && update.paid === undefined) {
    throw new Error("Provide an order status or paid value");
  }
  const result = await client.request("orders/update", {
    orders: [{
      order_id: update.orderId,
      ...(update.status !== undefined && { status: update.status }),
      ...(update.paid !== undefined && { payed: Number(update.paid) }),
    }],
  });
  if (result.status !== "OK") {
    const response = result.response;
    const log = response && typeof response === "object" && "log" in response ? response.log : undefined;
    const detail = Array.isArray(log) ? log.map((entry) => {
      if (!entry || typeof entry !== "object") return "unknown error";
      return "messages" in entry ? String(entry.messages) : "message" in entry ? String(entry.message) : "unknown error";
    }).join("; ") : "";
    throw new Error(`Horoshop orders/update returned ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  const log = responseField(result.response, "log");
  const parsed = z.array(z.object({ status: z.string(), messages: z.string().optional(), message: z.string().optional() }).passthrough()).safeParse(log);
  if (!parsed.success || parsed.data.length !== 1 || parsed.data[0]?.status !== "OK") {
    throw new Error("Horoshop did not confirm the order update");
  }
  return { orderId: update.orderId, updated: true };
}

export interface OrderSummary {
  from: string;
  to: string;
  orderCount: number;
  paidOrderCount: number;
  totalsByCurrency: Record<string, string>;
  ordersMissingTotal: number;
  countsByStatus: Record<string, number>;
  countsByUtmSource: Record<string, number>;
  complete: boolean;
  processedPages: number;
}

export async function summarizeOrders(client: HoroshopClient, from: string, to: string, maxPages = 50): Promise<OrderSummary> {
  let orderCount = 0;
  let paidOrderCount = 0;
  let ordersMissingTotal = 0;
  let processedPages = 0;
  let complete = false;
  const totalsByCurrency = new Map<string, string>();
  const countsByStatus = new Map<string, number>();
  const countsByUtmSource = new Map<string, number>();
  const limit = 100;
  for (let page = 0; page < maxPages; page += 1) {
    const orders = await listOrders(client, { from, to, offset: page * limit, limit });
    processedPages += 1;
    for (const order of orders) {
      orderCount += 1;
      if (order.payed === 1) paidOrderCount += 1;
      if (order.currency !== undefined && order.total_sum !== undefined) {
        totalsByCurrency.set(order.currency,
          addDecimal(totalsByCurrency.get(order.currency) ?? "0", order.total_sum));
      } else {
        ordersMissingTotal += 1;
      }
      const status = order.stat_status === undefined ? "unknown" : String(order.stat_status);
      countsByStatus.set(status, (countsByStatus.get(status) ?? 0) + 1);
      const source = order.analytics?.utm_source ?? "unknown";
      countsByUtmSource.set(source, (countsByUtmSource.get(source) ?? 0) + 1);
    }
    if (orders.length < limit) {
      complete = true;
      break;
    }
  }
  return {
    from,
    to,
    orderCount,
    paidOrderCount,
    totalsByCurrency: Object.fromEntries(totalsByCurrency),
    ordersMissingTotal,
    countsByStatus: Object.fromEntries(countsByStatus),
    countsByUtmSource: Object.fromEntries(countsByUtmSource),
    complete,
    processedPages,
  };
}
