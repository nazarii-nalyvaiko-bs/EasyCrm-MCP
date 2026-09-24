import type { HoroshopClient } from "./client.js";

export interface CustomerUpsert {
  name: string;
  email: string;
  phone?: string;
  note?: string;
}

export async function upsertCustomer(client: HoroshopClient, customer: CustomerUpsert): Promise<{ email: string; saved: true }> {
  const result = await client.request("users/import", {
    users: [{
      title: customer.name,
      email: customer.email,
      ...(customer.phone !== undefined && { phone: customer.phone }),
      ...(customer.note !== undefined && { note: customer.note }),
    }],
  });
  if (result.status !== "OK") throw new Error(`Horoshop users/import returned ${result.status}`);
  return { email: customer.email, saved: true };
}
