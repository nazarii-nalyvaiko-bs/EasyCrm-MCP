import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeOrders } from "../dist/horoshop/orders.js";

test("Horoshop totals sum decimal amounts exactly and preserve source keys", async () => {
  const calls = [];
  const client = {
    request: async (operation, parameters) => {
      assert.equal(operation, "orders/get");
      calls.push(parameters);
      return {
        status: "OK",
        response: {
          orders: [
            { order_id: 1, total_sum: 0.1, currency: "UAH", analytics: { utm_source: "__proto__" } },
            { order_id: 2, total_sum: "0.2", currency: "UAH", analytics: { utm_source: "__proto__" } },
          ],
        },
      };
    },
  };

  const summary = await summarizeOrders(client, "2026-09-01", "2026-09-02", 1);
  assert.deepEqual(calls, [{ from: "2026-09-01", to: "2026-09-02", offset: 0, limit: 100 }]);
  assert.deepEqual(summary.totalsByCurrency, { UAH: "0.3" });
  assert.equal(summary.countsByUtmSource.__proto__, 2);
  assert.deepEqual(Object.keys(summary.countsByUtmSource), ["__proto__"]);
});
