module.exports = {
  getChatHistory: require("./aiController/getChatHistory"),
  deleteChatHistoryItem: require("./aiController/deleteChatHistoryItem"),
  clearChatHistory: require("./aiController/clearChatHistory"),
  getAiSummary: require("./aiController/getAiSummary"),
  chatWithDocument: require("./aiController/chatWithDocument"),
  generateFlashcards: require("./aiController/generateFlashcards"),
  getDocumentFlashcards: require("./aiController/getDocumentFlashcards"),
};
