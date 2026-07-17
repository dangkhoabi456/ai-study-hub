const {
  mapWithConcurrency,
  normalizeConcurrency,
} = require("../../src/utils/asyncUtils");

describe("asyncUtils", () => {
  test("normalizes concurrency values", () => {
    expect(normalizeConcurrency("3")).toBe(3);
    expect(normalizeConcurrency(0, 2)).toBe(2);
    expect(normalizeConcurrency("invalid", 2)).toBe(2);
  });

  test("maps values concurrently while preserving result order", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `${index}:${delay}`;
    });

    expect(results).toEqual(["0:30", "1:10", "2:20"]);
  });

  test("never exceeds the requested concurrency", async () => {
    let active = 0;
    let maximumActive = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    expect(maximumActive).toBe(2);
  });

  test("propagates mapper failures", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (value) => {
        if (value === 2) throw new Error("failed");
        return value;
      }),
    ).rejects.toThrow("failed");
  });
});
