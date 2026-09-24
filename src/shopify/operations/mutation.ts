import { ShopifyUserError, type UserError } from "../errors.js";

export function unwrapMutation<T>(operation: string, payload: T | null | undefined, userErrors: UserError[]): T {
  if (userErrors.length > 0) throw new ShopifyUserError(operation, userErrors);
  if (payload == null) throw new Error(`${operation} returned no data and no errors`);
  return payload;
}

export function confirmDeletedId(operation: string, expectedId: string, deletedId: string | null, userErrors: UserError[]): string {
  const confirmed = unwrapMutation(operation, deletedId, userErrors);
  if (confirmed !== expectedId) throw new Error(`${operation} did not confirm deletion of ${expectedId}`);
  return confirmed;
}
