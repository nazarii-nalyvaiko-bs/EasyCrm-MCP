import { z } from "zod";
import type { HoroshopClient } from "./client.js";

const orderSchema = z.object({
  order_id: z.number().int(),
  stat_status: z.number().int().optional(),
  stat_created: z.string().optional(),
  total_sum: z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]).optional(),
  currency: z.string().optional(),
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
  if (!response || typeof response !== "object" || !(field in response)) {
    throw new Error(`Horoshop response is missing ${field}`);
  }
  return response[field as keyof typeof response];
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
  totalsByCurrency: Record<string, number>;
  ordersMissingTotal: number;
  countsByStatus: Record<string, number>;
  countsByUtmSource: Record<string, number>;
  complete: boolean;
  processedPages: number;
}

export async function summarizeOrders(client: HoroshopClient, from: string, to: string, maxPages = 50): Promise<OrderSummary> {
  const summary: OrderSummary = {
    from, to, orderCount: 0, paidOrderCount: 0, totalsByCurrency: {}, ordersMissingTotal: 0, countsByStatus: {},
    countsByUtmSource: {}, complete: false, processedPages: 0,
  };
  const limit = 100;
  for (let page = 0; page < maxPages; page += 1) {
    const orders = await listOrders(client, { from, to, offset: page * limit, limit });
    summary.processedPages += 1;
    for (const order of orders) {
      summary.orderCount += 1;
      if (order.payed === 1) summary.paidOrderCount += 1;
      if (order.currency && order.total_sum !== undefined) {
        summary.totalsByCurrency[order.currency] = (summary.totalsByCurrency[order.currency] ?? 0) + order.total_sum;
      } else {
        summary.ordersMissingTotal += 1;
      }
      const status = order.stat_status === undefined ? "unknown" : String(order.stat_status);
      summary.countsByStatus[status] = (summary.countsByStatus[status] ?? 0) + 1;
      const source = order.analytics?.utm_source || "unknown";
      summary.countsByUtmSource[source] = (summary.countsByUtmSource[source] ?? 0) + 1;
    }
    if (orders.length < limit) {
      summary.complete = true;
      break;
    }
  }
  return summary;
}
