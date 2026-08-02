const supabase = require("../config/supabase");
const { createActivityLog } = require("../services/activityLogService");
const { canAccessDocument } = require("../services/documentAccessService");
const {
  extractTextFromFile,
  splitTextIntoChunks,
} = require("../services/textExtractService");

const DAILY_FLASHCARD_LIMIT = 3;

const {
  createEmbedding,
  createBatchEmbeddings,
  toVectorLiteral,
  answerWithContext,
  generateFlashcardsFromChunks,
} = require("../services/aiService");

async function ensureDocumentChunks(document) {
  try {
    const { data: existingChunks, error: selectError } = await supabase
      .from("document_chunks")
      .select("chunk_index, content")
      .eq("document_id", document.id)
      .order("chunk_index", { ascending: true });

    if (!selectError && existingChunks && existingChunks.length > 0) {
      return existingChunks;
    }

    if (!document || !document.file_url) {
      return [];
    }

    const bucket = document.status === "FLAGGED" ? "document_waiting_admin" : "documents";
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(document.file_url);

    if (downloadError || !fileBlob) {
      console.error("Auto-repair chunks download error:", downloadError);
      return [];
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const extractedText = await extractTextFromFile({
      buffer,
      originalname: document.title,
      mimetype: document.title?.endsWith(".pdf")
        ? "application/pdf"
        : document.title?.endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain",
    });

    const chunks = splitTextIntoChunks(extractedText);
    if (chunks.length === 0) {
      return [];
    }

    const embeddings = await createBatchEmbeddings(chunks, "document");
    const chunkRows = chunks.map((chunk, index) => ({
      document_id: document.id,
      chunk_index: index,
      content: chunk,
      embedding: toVectorLiteral(embeddings[index]),
    }));

    await supabase.from("document_chunks").delete().eq("document_id", document.id);
    const { error: insertError } = await supabase.from("document_chunks").insert(chunkRows);

    if (insertError) {
      console.error("Auto-repair insert chunks error:", insertError);
      return [];
    }

    return chunkRows.map((r) => ({ chunk_index: r.chunk_index, content: r.content }));
  } catch (err) {
    console.error("ensureDocumentChunks error:", err);
    return [];
  }
}

function getVietnamDayRange() {
  const now = new Date();
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startUtcMs =
    Date.UTC(
      vietnamNow.getUTCFullYear(),
      vietnamNow.getUTCMonth(),
      vietnamNow.getUTCDate(),
    ) -
    7 * 60 * 60 * 1000;

  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function getFlashcardsCreatedToday(userId) {
  const { start, end } = getVietnamDayRange();
  const { data, error } = await supabase
    .from("activity_logs")
    .select("new_data")
    .eq("user_id", userId)
    .eq("action_type", "FLASHCARDS_GENERATED")
    .gte("created_at", start)
    .lt("created_at", end);

  if (error) throw error;

  return (data || []).reduce(
    (total, item) => total + Math.max(0, Number(item.new_data?.cardCount || 0)),
    0,
  );
}

async function getAllowedDocument(documentId, userId) {
  const { data: document, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!document) return null;

  if (!(await canAccessDocument(document, userId))) {
    return "FORBIDDEN";
  }

  return document;
}

async function increaseChatUsage(userId) {
  if (userId === "guest") {
    return;
  }
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing, error: selectError } = await supabase
    .from("ai_usage_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing && existing.chat_count >= 20) {
    const error = new Error("Daily AI chatbot quota exceeded.");
    error.statusCode = 429;
    throw error;
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("ai_usage_logs")
      .update({ chat_count: existing.chat_count + 1 })
      .eq("id", existing.id);

    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase.from("ai_usage_logs").insert({
    user_id: userId,
    usage_date: today,
    chat_count: 1,
    tokens_consumed: 0,
  });

  if (insertError) throw insertError;
}

function isGuestUser(user) {
  return user?.id === "guest" || user?.id === "00000000-0000-0000-0000-000000000000" || user?.role === "GUEST";
}

async function saveChatHistory({ userId, documentId, question, answer }) {
  const { data: conversation, error: conversationError } = await supabase
    .from("chat_conversations")
    .insert({
      user_id: userId,
      document_id: documentId,
      title: question.trim().slice(0, 120),
    })
    .select("id, document_id, title, created_at")
    .single();

  if (conversationError) throw conversationError;

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .insert([
      { conversation_id: conversation.id, role: "user", content: question.trim() },
      { conversation_id: conversation.id, role: "ai", content: answer },
    ])
    .select("id, role, content, created_at");

  if (messagesError) {
    await supabase.from("chat_conversations").delete().eq("id", conversation.id);
    throw messagesError;
  }

  return {
    conversationId: conversation.id,
    documentId: conversation.document_id,
    title: conversation.title,
    messages: messages || [],
  };
}

exports.getChatHistory = async (req, res) => {
  try {
    if (isGuestUser(req.user)) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const { data: conversations, error: conversationsError } = await supabase
      .from("chat_conversations")
      .select("id, document_id, title, created_at, updated_at")
      .eq("user_id", req.user.id)
      .order("updated_at", { ascending: false });
    if (conversationsError) throw conversationsError;

    const conversationIds = (conversations || []).map((conversation) => conversation.id);
    if (conversationIds.length === 0) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("id, conversation_id, role, content, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });
    if (messagesError) throw messagesError;

    const messagesByConversation = (messages || []).reduce((result, message) => {
      (result[message.conversation_id] ||= []).push({
        id: message.id,
        conversationId: message.conversation_id,
        role: message.role,
        text: message.content,
        createdAt: message.created_at,
      });
      return result;
    }, {});

    return res.status(200).json({
      status: "success",
      data: (conversations || []).map((conversation) => ({
        id: conversation.id,
        documentId: conversation.document_id,
        title: conversation.title,
        createdAt: conversation.created_at,
        messages: messagesByConversation[conversation.id] || [],
      })),
    });
  } catch (error) {
    console.error("getChatHistory error:", error);
    return res.status(500).json({ status: "error", message: "Could not load chat history." });
  }
};

exports.deleteChatHistoryItem = async (req, res) => {
  try {
    if (isGuestUser(req.user)) return res.status(204).send();

    const { error } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("id", req.params.conversationId)
      .eq("user_id", req.user.id);
    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    console.error("deleteChatHistoryItem error:", error);
    return res.status(500).json({ status: "error", message: "Could not delete chat history." });
  }
};

exports.clearChatHistory = async (req, res) => {
  try {
    if (isGuestUser(req.user)) return res.status(204).send();

    const { error } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("user_id", req.user.id);
    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    console.error("clearChatHistory error:", error);
    return res.status(500).json({ status: "error", message: "Could not clear chat history." });
  }
};

exports.getAiSummary = async (req, res) => {
  try {
    const chatLimit = 20;

    if (req.user.id === "guest" || req.user.id === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(200).json({
        status: "success",
        data: {
          chatLimit,
          chatsUsed: 0,
          chatsRemaining: chatLimit,
          tokensConsumed: 0,
        },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage, error } = await supabase
      .from("ai_usage_logs")
      .select("chat_count, tokens_consumed")
      .eq("user_id", req.user.id)
      .eq("usage_date", today)
      .maybeSingle();

    if (error) throw error;

    const chatsUsed = Math.max(0, Number(usage?.chat_count || 0));
    return res.status(200).json({
      status: "success",
      data: {
        chatLimit: 20,
        chatsUsed,
        chatsRemaining: Math.max(0, 20 - chatsUsed),
        tokensConsumed: Math.max(0, Number(usage?.tokens_consumed || 0)),
      },
    });
  } catch (error) {
    console.error("getAiSummary error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load AI usage summary.",
    });
  }
};

exports.chatWithDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { documentId, question } = req.body;

    if (!documentId || !question || !question.trim()) {
      return res.status(400).json({
        status: "error",
        message: "documentId and question are required.",
      });
    }

    const document = await getAllowedDocument(documentId, userId);

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found.",
      });
    }

    if (document === "FORBIDDEN") {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this document.",
      });
    }

    if (document.status !== "APPROVED") {
      return res.status(409).json({
        status: "error",
        code: "DOCUMENT_NOT_AI_READY",
        message: "This document is not approved or not ready for AI chat yet.",
      });
    }

    const questionEmbedding = await createEmbedding(question, "query");

    let matchedChunks = [];
    try {
      const { data: rpcChunks } = await supabase.rpc("match_document_chunks", {
        match_document_id: documentId,
        query_embedding: toVectorLiteral(questionEmbedding),
        match_count: 5,
      });
      if (Array.isArray(rpcChunks) && rpcChunks.length > 0) {
        matchedChunks = rpcChunks;
      }
    } catch (e) {
      console.warn("RPC match_document_chunks error or fallback:", e);
    }

    if (matchedChunks.length === 0) {
      const availableChunks = await ensureDocumentChunks(document);
      matchedChunks = availableChunks.slice(0, 5);
    }

    if (!matchedChunks || matchedChunks.length === 0) {
      return res.status(409).json({
        status: "error",
        code: "DOCUMENT_CHUNKS_UNAVAILABLE",
        message: "No AI chunks found for this document. Re-upload or re-process it.",
      });
    }

    const answer = await answerWithContext(question, matchedChunks);
    await increaseChatUsage(userId);
    let chatHistory = null;
    try {
      chatHistory = await saveChatHistory({ userId, documentId, question, answer });
    } catch (historyError) {
      // Do not hide a valid AI answer if history persistence is temporarily unavailable.
      // The frontend retains a per-user cache so the user does not lose the answer.
      console.error("Could not save chat history:", historyError);
    }

    return res.status(200).json({
      status: "success",
      data: {
        documentId,
        question,
        answer,
        sources: matchedChunks.map((chunk) => ({
          chunk_index: chunk.chunk_index,
          similarity: chunk.similarity || 1,
        })),
        chatHistory,
      },
    });
  } catch (error) {
    console.error("chatWithDocument error:", error);

    return res.status(error.statusCode || 500).json({
      status: "error",
      message: error.message || "Could not chat with document.",
    });
  }
};

exports.generateFlashcards = async (req, res) => {
  try {
    const userId = req.user.id;
    const { documentId } = req.params;

    const document = await getAllowedDocument(documentId, userId);

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found.",
      });
    }

    if (document === "FORBIDDEN") {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this document.",
      });
    }

    if (document.status !== "APPROVED") {
      return res.status(400).json({
        status: "error",
        message: "This document is not approved or not ready for flashcard generation yet.",
      });
    }

    // Increment AI Usage limit (1 operation against 20 daily AI usage limit)
    await increaseChatUsage(userId);

    let chunks = (await ensureDocumentChunks(document)) || [];
    if (!Array.isArray(chunks)) chunks = [];
    chunks = chunks.slice(0, 30);

    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No chunks found for this document. Re-upload or re-process it.",
      });
    }

    const generatedCards = await generateFlashcardsFromChunks(chunks);
    const cards = generatedCards.slice(0, 20);

    // Delete old flashcards for this document if regenerating
    await supabase.from("flashcards").delete().eq("document_id", documentId);

    const rows = cards.map((card) => ({
      document_id: documentId,
      workspace_id: document.workspace_id || null,
      creator_id: userId,
      question: card.question,
      answer: card.answer,
    }));

    const result = await supabase
      .from("flashcards")
      .insert(rows)
      .select("*");

    if (result.error) throw result.error;
    const cardsList = Array.isArray(result.data) ? result.data : rows;

    if (cardsList.length > 0) {
      await createActivityLog({
        actorUserId: userId,
        actionType: "FLASHCARDS_GENERATED",
        entityType: "document",
        entityId: documentId,
        newData: {
          cardCount: cardsList.length,
          dailyLimit: 20,
        },
        request: req,
        details: `Generated ${cardsList.length} flashcard(s).`,
      });
    }

    return res.status(201).json({
      status: "success",
      data: cardsList,
      quota: {
        dailyLimit: 20,
      },
    });
  } catch (error) {
    console.error("generateFlashcards error:", error);

    return res.status(error.statusCode || 500).json({
      status: "error",
      message: error.message || "Failed to generate flashcards.",
    });
  }
};

exports.getDocumentFlashcards = async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;

    if (userId === "guest" || userId === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(200).json({ status: "success", data: [] });
    }

    const { data: flashcards, error } = await supabase
      .from("flashcards")
      .select("id, document_id, workspace_id, creator_id, question, answer, created_at")
      .eq("document_id", documentId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.status(200).json({ status: "success", data: flashcards || [] });
  } catch (error) {
    console.error("getDocumentFlashcards error:", error);
    return res.status(500).json({ status: "error", message: "Could not load flashcards." });
  }
};
