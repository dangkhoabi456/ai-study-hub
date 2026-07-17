jest.mock("../../src/config/supabase", () => ({}));
jest.mock("../../src/services/textExtractService", () => ({
  extractTextFromFile: jest.fn(),
  splitTextIntoChunks: jest.fn(),
}));
jest.mock("../../src/services/aiService", () => ({
  moderateDocument: jest.fn(),
  createEmbedding: jest.fn(),
  toVectorLiteral: jest.fn(),
  checkSensitiveContent: jest.fn(),
  validateTagsAndContent: jest.fn(),
}));
jest.mock("../../src/services/activityLogService", () => ({
  createActivityLog: jest.fn(),
}));

const {
  extractTextFromFile,
} = require("../../src/services/textExtractService");
const {
  validateTagsAndContent,
} = require("../../src/services/aiService");
const {
  suggestTagsForFile,
} = require("../../src/controllers/documentController");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("documentController.suggestTagsForFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requires one uploaded document", async () => {
    const response = createResponse();

    await suggestTagsForFile({}, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(extractTextFromFile).not.toHaveBeenCalled();
  });

  test("rejects documents without enough readable text", async () => {
    extractTextFromFile.mockResolvedValue("too short");
    const response = createResponse();

    await suggestTagsForFile({ file: { originalname: "notes.txt" } }, response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(validateTagsAndContent).not.toHaveBeenCalled();
  });

  test("returns normalized optional suggestions", async () => {
    const readableText = "A sufficiently detailed mathematics document about algebra.";
    extractTextFromFile.mockResolvedValue(readableText);
    validateTagsAndContent.mockResolvedValue({
      aiRecommendedTags: [" math ", "#Math", "#linear algebra"],
    });
    const response = createResponse();

    await suggestTagsForFile({ file: { originalname: "notes.txt" } }, response);

    expect(validateTagsAndContent).toHaveBeenCalledWith(
      readableText,
      "notes.txt",
      [],
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      status: "success",
      data: { tags: ["#math", "#linearalgebra"] },
    });
  });

  test("returns a controlled response when AI produces no suggestions", async () => {
    extractTextFromFile.mockResolvedValue(
      "A sufficiently detailed document with readable educational content.",
    );
    validateTagsAndContent.mockResolvedValue({ aiRecommendedTags: [] });
    const response = createResponse();

    await suggestTagsForFile({ file: { originalname: "notes.txt" } }, response);

    expect(response.status).toHaveBeenCalledWith(422);
  });
});
