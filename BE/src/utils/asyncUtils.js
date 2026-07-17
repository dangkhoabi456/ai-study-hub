function normalizeConcurrency(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items || []);
  if (values.length === 0) return [];

  const results = new Array(values.length);
  const workerCount = Math.min(
    normalizeConcurrency(concurrency),
    values.length,
  );
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker()),
  );
  const failedWorker = workerResults.find(({ status }) => status === "rejected");

  if (failedWorker) throw failedWorker.reason;

  return results;
}

module.exports = {
  mapWithConcurrency,
  normalizeConcurrency,
};
