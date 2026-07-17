function normalizeSuggestedTags(tags, limit = 5) {
  const parsedLimit = Number.parseInt(limit, 10);
  const maximum = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 10)
    : 5;
  const seen = new Set();
  const normalizedTags = [];

  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag || "")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "");
    const comparisonKey = value.toLocaleLowerCase();

    if (!value || seen.has(comparisonKey)) continue;

    seen.add(comparisonKey);
    normalizedTags.push(`#${value}`);

    if (normalizedTags.length === maximum) break;
  }

  return normalizedTags;
}

module.exports = { normalizeSuggestedTags };
