let aiClient = null;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Create and reuse Gemini client.
 *
 * We use dynamic import because many Node/Express projects use CommonJS require(),
 * while @google/genai is easier to load with import().
 */
async function getAiClient() {
  if (aiClient) {
    return aiClient;
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env file.");
  }

  const { GoogleGenAI } = await import("@google/genai");

  aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  return aiClient;
}

function getOpenAiConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    baseUrl: process.env.OPENAI_BASE_URL || OPENAI_CHAT_COMPLETIONS_URL,
  };
}

function isRetryableAiError(error) {
  const statusCode = Number(error?.status);
  return [404, 429, 503].includes(statusCode);
}

async function generateTextWithOpenAi(prompt) {
  const { apiKey, model, baseUrl } = getOpenAiConfig();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env file.");
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || "OpenAI text generation failed.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data?.choices?.[0]?.message?.content || "";
}

/**
 * Extract JSON from Gemini output.
 * Sometimes AI wraps JSON in ```json ... ```, so this function cleans it.
 */
function extractJson(text) {
  const raw = String(text || "").trim();

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = codeBlockMatch ? codeBlockMatch[1].trim() : raw;

  const objectStart = cleaned.indexOf("{");
  const arrayStart = cleaned.indexOf("[");

  let start = -1;
  let end = -1;

  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    start = arrayStart;
    end = cleaned.lastIndexOf("]");
  } else {
    start = objectStart;
    end = cleaned.lastIndexOf("}");
  }

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI did not return valid JSON.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * General text generation using Gemini first, then OpenAI if Gemini is rate-limited.
 */
async function generateText(prompt) {
  const ai = await getAiClient();
  const configuredFallbackModels = String(
    process.env.GEMINI_TEXT_FALLBACK_MODELS ||
      "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite",
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const modelCandidates = [
    process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
    ...configuredFallbackModels,
  ].filter((model, index, models) => models.indexOf(model) === index);
  const modelErrors = [];

  for (const model of modelCandidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      return response.text || "";
    } catch (error) {
      modelErrors.push(error);
      const statusCode = Number(error?.status);
      const canTryFallback = isRetryableAiError(error);
      const hasAnotherModel = model !== modelCandidates.at(-1);

      if (!canTryFallback || !hasAnotherModel) {
        break;
      }

      console.warn(
        `[Gemini] Model ${model} is unavailable (${error.status}); trying a fallback model.`,
      );

      // Nếu gặp lỗi 429 (Rate limit / Quota), tạm hoãn 1 giây trước khi chuyển model
      if (statusCode === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // Preserve the actionable service error instead of blindly throwing the
  // final fallback error. For example, an exhausted model (429) followed by a
  // retired fallback (404) must still be reported as quota exhaustion.
  const actionableError =
    modelErrors.find((error) => Number(error?.status) === 429) ||
    modelErrors.find((error) => Number(error?.status) === 503) ||
    modelErrors.at(-1);

  if (process.env.OPENAI_API_KEY && isRetryableAiError(actionableError)) {
    console.warn("[AI] Gemini text models unavailable; trying OpenAI fallback.");
    return generateTextWithOpenAi(prompt);
  }

  throw actionableError || new Error("No AI text model is available.");
}

/**
 * Create vector embedding for document chunks or user questions.
 *
 * Supabase pgvector column is VECTOR(768), so outputDimensionality = 768.
 */
async function createEmbedding(text, mode = "document", maxRetries = 3) {
  const ai = await getAiClient();

  const prefix =
    mode === "query"
      ? "Represent this question for retrieving relevant study document chunks: "
      : "Represent this study document chunk for retrieval: ";

  const promptText = prefix + String(text || "").slice(0, 7000);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
        contents: promptText,
        config: {
          outputDimensionality: 768,
        },
      });

      const values = response.embeddings?.[0]?.values;

      if (!values || !Array.isArray(values)) {
        throw new Error("Could not create embedding from Gemini.");
      }

      return values;
    } catch (error) {
      const statusCode = Number(error?.status || error?.statusCode);
      const isQuotaError =
        statusCode === 429 || String(error?.message).includes("quota");

      if (isQuotaError && attempt < maxRetries) {
        const delayMs = attempt * 2500;
        console.warn(
          `[Gemini Embedding] 429 Rate-limited/Quota exceeded. Retrying batch in ${delayMs}ms (Attempt ${attempt}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw error;
    }
  }
}

/**
 * Convert embedding array to pgvector string format.
 *
 * Example:
 * [0.1, 0.2, 0.3]
 *
 * Supabase/PostgREST usually handles pgvector better as a string literal.
 */
function toVectorLiteral(values) {
  if (!Array.isArray(values)) {
    throw new Error("Embedding values must be an array.");
  }

  return `[${values.join(",")}]`;
}

/**
 * Answer a question using retrieved document chunks.
 */
function removeChunkReferences(answer) {
  return String(answer || "")
    .replace(
      /(?:^|\n)\s*(?:this\s+(?:answer|response)|the\s+answer|support(?:ing)?\s+evidence)\s+(?:is\s+)?(?:supported|grounded|based)\s+by\s+\*{0,2}chunks?\s*\d+(?:\s*(?:,|and)\s*\d+)*\*{0,2}\s*\.?\s*(?=\n|$)/gim,
      "\n",
    )
    .replace(
      /\s*\(?\[?\*{0,2}(?:source:\s*)?chunks?\s*\d+(?:\s*(?:,|and)\s*\d+)*\*{0,2}\]?\)?\s*\.?/gi,
      "",
    )
    .replace(/\*+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function answerWithContext(question, chunks) {
  const context = chunks
    .map((chunk, index) => {
      return `[Chunk ${index + 1}, database chunk_index: ${chunk.chunk_index}, similarity: ${chunk.similarity}]
${chunk.content}`;
    })
    .join("\n\n");

  const prompt = `
You are StudyHub Assistant.

Answer the student's question using ONLY the document context below.

Rules:
- If the answer is not in the context, say: "I cannot find this in the uploaded document."
- Give a clear student-friendly answer.
- Do not mention chunks, chunk numbers, retrieval metadata, or source labels.
- Return plain text without Markdown asterisks or bold formatting.
- Do not invent facts outside the document.

Question:
${question}

Document context:
${context}
`;

  const answer = await generateText(prompt);
  return removeChunkReferences(answer);
}

/**
 * Generate flashcards from document chunks.
 */
async function generateFlashcardsFromChunks(chunks) {
  const content = chunks
    .map((chunk) => chunk.content)
    .join("\n\n")
    .slice(0, 25000);

  const prompt = `
Create study flashcards from the document content.

Return JSON array only in this exact format:
[
  {
    "question": "short question",
    "answer": "short answer"
  }
]

Rules:
- Generate UP TO 20 flashcards depending on text length and content depth:
  * For shorter documents: Generate 3 to 8 essential flashcards.
  * For longer, richer documents: Generate 10 to 20 diverse, non-repetitive, high-yield study flashcards covering key topics across the entire text.
- LANGUAGE: Write ALL questions and answers in VIETNAMESE (Tiếng Việt) if the document is in Vietnamese or bilingual. Default to VIETNAMESE for student study materials.
- Ensure questions and answers cover distinct, diverse concepts without duplicate content.
- Keep answers clear and concise.
- Use only the document content.
- Do not invent information.

Document content:
${content}
`;

  const resultText = await generateText(prompt);
  const cards = extractJson(resultText);

  if (!Array.isArray(cards)) {
    throw new Error("AI flashcard result must be a JSON array.");
  }

  return cards
    .filter((card) => card.question && card.answer)
    .slice(0, 20)
    .map((card) => ({
      question: String(card.question).trim(),
      answer: String(card.answer).trim(),
    }));
}

// src/services/aiService.js

async function generateTagsAndName(extractedText, originalName) {
  // Only take the first ~1000 characters to save tokens
  const sampleText = String(extractedText || "").substring(0, 1000);

  const prompt = `You are a document classification system. 
  Original filename: "${originalName}"
  Extracted content: "${sampleText}"
  
  Tasks:
  1. Suggest 1-3 tags describing the content (nouns, e.g. #math, #grade12).
  2. Check if the original filename has spelling errors or incorrect subject naming. If incorrect, suggest a new name and a short notice message. If correct, leave empty.
  
  MUST return strictly in the following JSON format, with no extra text:
  {
    "tags": ["#tag1", "#tag2"],
    "suggestedName": "Standard name (if change needed)",
    "message": "Notice message (e.g., The file is about math but named physics, would you like to rename it to math.pdf?)"
  }`;

  try {
    const resultText = await generateText(prompt);
    const result = extractJson(resultText);
    return {
      tags: Array.isArray(result.tags) ? result.tags : [],
      suggestedName: result.suggestedName || "",
      message: result.message || ""
    };
  } catch (error) {
    console.error("Error in generateTagsAndName with Gemini:", error);
    return {
      tags: [],
      suggestedName: "",
      message: ""
    };
  }
}

function isWholeWordPresent(text, word) {
  const esc = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const boundaryChars = "a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ";
  const regex = new RegExp(`(?<=^|[^${boundaryChars}])${esc}(?=$|[^${boundaryChars}])`, "i");
  return regex.test(text);
}

async function checkSensitiveContent(text) {
  const sampleText = String(text || "").substring(0, 8000);

  const prompt = `You are an automated content moderation system for an academic learning environment. 
Read the document text below and list EXACTLY the profane or violating words/phrases (e.g. 'stupid' or 'stupid, damn').

Document text:
"${sampleText}"

MUST return strictly in the following JSON format, with no explanation outside the JSON:
{
  "classification": "SEVERE" (if extremely profane, sexually explicit, or severely offensive) or "MILD" (if mild profanity or mild slang) or "NONE" (if clean/normal document),
  "word": "list only the violating words separated by commas (e.g., 'stupid'). IF NO PROFANITY, RETURN NULL",
  "suspicious_text": "write exact violating words only (e.g., 'stupid'), ABSOLUTELY DO NOT WRITE FULL SENTENCES"
}`;

  try {
    const resultText = await generateText(prompt);
    const result = extractJson(resultText);
    const extractedWords = result.word || result.suspicious_text || null;
    return {
      classification: ["SEVERE", "MILD", "NONE"].includes(result.classification) ? result.classification : "NONE",
      word: extractedWords,
      suspicious_text: extractedWords
    };
  } catch (error) {
    console.error("AI checkSensitiveContent error:", error);
    return { classification: "NONE", word: null, suspicious_text: null };
  }
}

async function analyzeDocumentForUpload(
  extractedText,
  originalName,
  userTags = [],
  options = {},
) {
  const sampleText = String(extractedText || "").substring(0, 8000);

  const prompt = `You are an AI document analysis system for student study materials on AI StudyHub.
Original filename: "${originalName}"
Document content (first 8000 chars): "${sampleText}"
User input hashtags: ${JSON.stringify(userTags)}

Your tasks:
1. For EACH hashtag in the user list, check:
   - Does it have spelling errors? Note: CamelCase like #SoftwareTesting, #BugReport, #SecurityVulnerability are standard valid hashtag formats and MUST be marked valid (isValid: true).
   - Format: Starts with # and no spaces. If user entered with # (e.g. #BugReport), consider it VALID (isValid: true).
   - Does it reflect the content or study topic?
2. Suggest 3-5 additional relevant hashtags based on document content (always starting with #, no spaces, written in English).
3. Check for profane, inappropriate, or violating words in the text.

MUST return strictly in the following JSON format:
{
  "tagValidations": [
    {
      "tag": "tag_name",
      "isValid": true or false,
      "recommendedReplacement": "#suggested_replacement_tag",
      "reason": "English explanation ONLY if replacement is needed; otherwise empty string"
    }
  ],
  "aiRecommendedTags": ["#recommendation1", "#recommendation2", "#recommendation3"],
  "sensitivity": {
    "classification": "SEVERE" or "MILD" or "NONE",
    "word": "violating words separated by commas, or null",
    "suspicious_text": "violating words or null"
  }
}`;

  try {
    const responseText = await generateText(prompt);
    const result = extractJson(responseText);

    const tagValidations = (result.tagValidations || []).map((v) => {
      const originalTag = String(v.tag || "").trim();
      let recTag = String(v.recommendedReplacement || originalTag).trim();
      if (recTag && !recTag.startsWith("#")) {
        recTag = "#" + recTag;
      }

      const normOriginal = originalTag.startsWith("#") ? originalTag : "#" + originalTag;
      const normRec = recTag.startsWith("#") ? recTag : "#" + recTag;

      let isValid = typeof v.isValid === "boolean" ? v.isValid : true;
      let reason = v.reason || "";

      // Sanity check: If the user tag starts with #, has no spaces, and matches recommendation, it is VALID.
      if (normOriginal.toLowerCase() === normRec.toLowerCase()) {
        isValid = true;
        reason = "";
      }

      return {
        tag: originalTag,
        isValid,
        recommendedReplacement: normRec,
        reason: isValid ? "" : reason,
      };
    });

    const isValid = tagValidations.every((v) => v.isValid === true);
    const aiRecommendedTags = Array.isArray(result.aiRecommendedTags)
      ? result.aiRecommendedTags
      : [];

    const sensitivityObj = result.sensitivity || {};
    const extractedWords = sensitivityObj.word || sensitivityObj.suspicious_text || null;
    const classification = ["SEVERE", "MILD", "NONE"].includes(sensitivityObj.classification)
      ? sensitivityObj.classification
      : "NONE";

    return {
      isValid,
      tagValidations,
      aiRecommendedTags,
      sensitivity: {
        classification,
        word: extractedWords,
        suspicious_text: extractedWords,
      },
    };
  } catch (error) {
    console.error("Error in analyzeDocumentForUpload:", error);
    if (options.throwOnError) {
      throw error;
    }

    return {
      isValid: true,
      tagValidations: userTags.map((t) => ({
        tag: t,
        isValid: true,
        recommendedReplacement: t,
        reason: "",
      })),
      aiRecommendedTags: [],
      sensitivity: { classification: "NONE", word: null, suspicious_text: null },
    };
  }
}

async function createBatchEmbeddings(chunks, mode = "document") {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const BATCH_SIZE = 10;
  const results = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((chunk) => createEmbedding(chunk, mode)),
    );
    results.push(...batchResults);
  }
  return results;
}

async function validateTagsAndContent(
  extractedText,
  originalName,
  userTags = [],
  options = {},
) {
  return analyzeDocumentForUpload(extractedText, originalName, userTags, options);
}

module.exports = {
  removeChunkReferences,
  createEmbedding,
  createBatchEmbeddings,
  toVectorLiteral,
  answerWithContext,
  generateFlashcardsFromChunks,
  generateTagsAndName,
  validateTagsAndContent,
  analyzeDocumentForUpload,
};

