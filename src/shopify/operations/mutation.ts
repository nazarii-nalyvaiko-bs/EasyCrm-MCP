import { ShopifyUserError, type UserError } from "../errors.js";

export function unwrapMutation<T>(operation: string, payload: T | null | undefined, userErrors: UserError[]): T {
  if (userErrors.length > 0) throw new ShopifyUserError(operation, userErrors);
  if (payload == null) throw new Error(`${operation} returned no data and no errors`);
  return payload;
}
