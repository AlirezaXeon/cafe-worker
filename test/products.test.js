import { test } from "node:test";
import assert from "node:assert/strict";
import { updateProduct } from "../src/data/products.js";

test("updateProduct validates explicit originalPrice and discards invalid values", async () => {
  let boundArgs = null;
  const mockEnv = {
    DB: {
      prepare: () => ({
        bind: (...args) => {
          boundArgs = args;
          return {
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
    },
  };

  // 1: explicitOriginal > finalPrice -> kept
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 50000,
    originalPrice: 70000,
  });
  // args: name, category, note, finalPrice, originalPrice, image, available, id
  assert.equal(boundArgs[3], 50000);
  assert.equal(boundArgs[4], 70000);

  // 2: explicitOriginal < finalPrice -> null
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 50000,
    originalPrice: 40000,
  });
  assert.equal(boundArgs[3], 50000);
  assert.equal(boundArgs[4], null);

  // 3: explicitOriginal == finalPrice -> null
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 50000,
    originalPrice: 50000,
  });
  assert.equal(boundArgs[4], null);

  // 4: explicitOriginal is negative or 0 -> null
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 50000,
    originalPrice: -1000,
  });
  assert.equal(boundArgs[4], null);

  // 5: explicitOriginal is null -> null
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 50000,
    originalPrice: null,
  });
  assert.equal(boundArgs[4], null);

  // 6: explicitOriginal is undefined -> uses discount logic
  await updateProduct(mockEnv, "p1", {
    category: "c1",
    name: "Espresso",
    price: 100000,
    discount: 20,
  });
  assert.equal(boundArgs[3], 80000);
  assert.equal(boundArgs[4], 100000);
});
