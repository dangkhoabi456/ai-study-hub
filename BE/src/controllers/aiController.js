const supabase = require("../config/supabase");
const { createActivityLog } = require("../services/activityLogService");

const DAILY_FLASHCARD_LIMIT = 3;

const {
  createEmbedding,
  toVectorLiteral,
  answerWithContext,
  generateFlashcardsFromChunks,
} = require("../services/aiService");

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

  const isOwner = String(document.uploader_id) === String(userId);

  if (!isOwner && document.is_public !== true) {
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

  if (existing && existing.chat_count >= 50) {
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

exports.getAiSummary = async (req, res) => {
  try {
    const chatLimit = 50;
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
        chatLimit,
        chatsUsed,
        chatsRemaining: Math.max(0, chatLimit - chatsUsed),
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
      return res.status(400).json({
        status: "error",
        message: "This document is not approved or not ready for AI chat yet.",
      });
    }

    await increaseChatUsage(userId);

    const questionEmbedding = await createEmbedding(question, "query");

    const { data: chunks, error: matchError } = await supabase.rpc(
      "match_document_chunks",
      {
        match_document_id: documentId,
        query_embedding: toVectorLiteral(questionEmbedding),
        match_count: 5,
      }
    );

    if (matchError) throw matchError;

    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No AI chunks found for this document. Re-upload or re-process it.",
      });
    }

    const answer = await answerWithContext(question, chunks);

    return res.status(200).json({
      status: "success",
      data: {
        documentId,
        question,
        answer,
        sources: chunks.map((chunk) => ({
          chunk_index: chunk.chunk_index,
          similarity: chunk.similarity,
        })),
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
    const cardsCreatedToday = await getFlashcardsCreatedToday(userId);
    const remainingCards = Math.max(
      0,
      DAILY_FLASHCARD_LIMIT - cardsCreatedToday,
    );

    if (remainingCards === 0) {
      return res.status(429).json({
        status: "error",
        code: "DAILY_FLASHCARD_LIMIT_REACHED",
        message: `You can create up to ${DAILY_FLASHCARD_LIMIT} flashcards per day. Please try again tomorrow.`,
        data: {
          dailyLimit: DAILY_FLASHCARD_LIMIT,
          createdToday: cardsCreatedToday,
          remainingToday: 0,
        },
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
      return res.status(400).json({
        status: "error",
        message: "This document is not approved or not ready for flashcard generation yet.",
      });
    }

    const { data: chunks, error: chunkError } = await supabase
      .from("document_chunks")
      .select("chunk_index, content")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .limit(10);

    if (chunkError) throw chunkError;

    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No chunks found for this document. Re-upload or re-process it.",
      });
    }

    const generatedCards = await generateFlashcardsFromChunks(chunks);
    const cards = generatedCards.slice(0, remainingCards);

    await supabase.from("flashcards").delete().eq("document_id", documentId);

    const rows = cards.map((card) => ({
      document_id: documentId,
      workspace_id: document.workspace_id || null,
      creator_id: userId,
      question: card.question,
      answer: card.answer,
    }));

    const { data: insertedCards, error: insertError } = await supabase
      .from("flashcards")
      .insert(rows)
      .select("*");

    if (insertError) throw insertError;

    if (insertedCards.length > 0) {
      await createActivityLog({
        actorUserId: userId,
        actionType: "FLASHCARDS_GENERATED",
        entityType: "document",
        entityId: documentId,
        newData: {
          cardCount: insertedCards.length,
          dailyLimit: DAILY_FLASHCARD_LIMIT,
        },
        request: req,
        details: `Generated ${insertedCards.length} flashcard(s).`,
      });
    }

    return res.status(201).json({
      status: "success",
      data: insertedCards,
      quota: {
        dailyLimit: DAILY_FLASHCARD_LIMIT,
        createdToday: cardsCreatedToday + insertedCards.length,
        remainingToday: Math.max(
          0,
          DAILY_FLASHCARD_LIMIT - cardsCreatedToday - insertedCards.length,
        ),
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
