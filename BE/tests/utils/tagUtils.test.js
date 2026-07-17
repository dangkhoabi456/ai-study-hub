const { normalizeSuggestedTags } = require("../../src/utils/tagUtils");

describe("tagUtils", () => {
  test("normalizes, deduplicates, and limits AI suggestions", () => {
    expect(
      normalizeSuggestedTags(
        [" math ", "#Math", "#software testing", "", "#Grade12"],
        3,
      ),
    ).toEqual(["#math", "#softwaretesting", "#Grade12"]);
  });

  test("returns an empty list for invalid input", () => {
    expect(normalizeSuggestedTags(null)).toEqual([]);
  });

  test("caps an unsafe limit", () => {
    const tags = Array.from({ length: 12 }, (_, index) => `tag${index}`);
    expect(normalizeSuggestedTags(tags, 50)).toHaveLength(10);
  });
});
