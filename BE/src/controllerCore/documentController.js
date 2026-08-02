const crypto = require("crypto");
const path = require("path");
const supabase = require("../config/supabase");
const MAX_LIBRARIES_PER_USER = 5;

const {
  extractTextFromFile,
  splitTextIntoChunks,
} = require("../services/textExtractService");

const {
  createEmbedding,
  createBatchEmbeddings,
  toVectorLiteral,
  validateTagsAndContent,
  analyzeDocumentForUpload,
} = require("../services/aiService");
const {
  mapWithConcurrency,
  normalizeConcurrency,
} = require("../utils/asyncUtils");
const { normalizeSuggestedTags } = require("../utils/tagUtils");
const {
  parseReplacementDocumentIds,
  resolveDuplicateUploadDecisions,
} = require("../utils/documentDuplicateUtils");

const BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "documents";
const WAITING_BUCKET = process.env.SUPABASE_DOCUMENT_WAITING_ADMIN_APPROVED || "document_waiting_admin";
const { createActivityLog } = require("../services/activityLogService");
const { canAccessDocument } = require("../services/documentAccessService");
const FILE_VALIDATION_CONCURRENCY = Math.min(
  normalizeConcurrency(process.env.FILE_VALIDATION_CONCURRENCY, 2),
  4,
);
const FILE_UPLOAD_CONCURRENCY = Math.min(
  normalizeConcurrency(process.env.FILE_UPLOAD_CONCURRENCY, 2),
  4,
);
const EMBEDDING_CONCURRENCY = Math.min(
  normalizeConcurrency(process.env.EMBEDDING_CONCURRENCY, 3),
  8,
);
const LIBRARY_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

function normalizeUploadedFileName(fileName) {
  const value = String(fileName || "");
  if (!value || [...value].some((character) => character.charCodeAt(0) > 255)) {
    return value.normalize("NFC");
  }

  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value.normalize("NFC") : decoded.normalize("NFC");
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(fileName || "upload.bin");

  return baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

async function getWorkspaceDocumentUploadAccess(workspaceId, userId) {
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, created_by")
    .eq("id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (workspaceError) throw workspaceError;
  if (!workspace) {
    return { exists: false, canUpload: false, canReplaceAny: false };
  }

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) throw memberError;

  const normalizedRole = String(member?.role || "").trim().toLowerCase();
  const isCreator = String(workspace.created_by) === String(userId);
  const isAdmin = isCreator || normalizedRole === "admin";

  return {
    exists: true,
    canUpload:
      isAdmin || normalizedRole === "editor",
    canReplaceAny: isAdmin,
  };
}

async function processDocumentWithAI(
  file,
  documentId,
  preExtractedText = null,
  overrideStatus = null,
  overrideRejectReason = null,
) {
  try {
    const extractedText = preExtractedText || await extractTextFromFile(file);

    if (!extractedText || extractedText.trim().length < 20) {
      await supabase
        .from("documents")
        .update({
          status: "REJECTED",
          ai_reject_reason: { reason: "Could not extract enough readable text from this file." },
        })
        .eq("id", documentId);
      //file rỗng hoặc ít hơn 20 kí tự
      return { status: "REJECTED", reason: "Could not extract enough readable text", chunkCount: 0 };
    }

    let status = overrideStatus || "APPROVED";
    let aiRejectReason = overrideRejectReason || null;

      const chunks = splitTextIntoChunks(extractedText);

      if (chunks.length === 0) {
        await supabase
          .from("documents")
          .update({
            status: "REJECTED",
            ai_reject_reason: { reason: "No readable text chunks could be created." },
          })
          .eq("id", documentId);

        return { status: "REJECTED", reason: "No readable text chunks could be created.", chunkCount: 0 };
      }

      const embeddings = await createBatchEmbeddings(chunks, "document");
      const chunkRows = chunks.map((chunk, index) => ({
        document_id: documentId,
        chunk_index: index,
        content: chunk,
        embedding: toVectorLiteral(embeddings[index]),
      }));

      await supabase.from("document_chunks").delete().eq("document_id", documentId);

      const { error: chunkInsertError } = await supabase.from("document_chunks").insert(chunkRows);

      if (chunkInsertError) {
        throw chunkInsertError;
      }

      const updatePayload = {
        status: status,
        ai_reject_reason: aiRejectReason,
      };

      await supabase.from("documents").update(updatePayload).eq("id", documentId);

      return {
        status: status,
        reason: "Document processed.",
        chunkCount: chunks.length,
      };
  } catch (error) {
    console.error("AI processing failed:", error);

    await supabase
      .from("documents")
      .update({
        status: "PENDING_RETRY",
        ai_reject_reason: {
          reason: "AI processing failed. Manual review may be needed.",
          error: error.message,
        },
      })
      .eq("id", documentId);

    return {
      status: "PENDING_RETRY",
      reason: "AI processing failed. Manual review may be needed.",
      error: error.message,
      chunkCount: 0,
    };
  }
}

async function processWorkspaceDocumentInBackground(
  file,
  documentId,
  storagePath,
  userTags,
) {
  try {
    const extractedText = await extractTextFromFile(file);
    const tagValidation = await validateTagsAndContent(extractedText, file.originalname, userTags);

    if (!tagValidation.isValid) {
      await supabase
        .from("documents")
        .update({
          status: "REJECTED",
          ai_reject_reason: {
            reason: "Document tags do not match the uploaded content.",
            tagValidations: tagValidation.tagValidations || [],
          },
        })
        .eq("id", documentId);
      return;
    }

    await processDocumentWithAI(
      file,
      documentId,
      extractedText,
      "PENDING",
      null,
    );
  } catch (error) {
    console.error("Background workspace document validation failed:", error);
    await supabase
      .from("documents")
      .update({
        status: "PENDING_RETRY",
        ai_reject_reason: {
          reason: "AI processing failed. Manual review may be needed.",
          error: error.message,
        },
      })
      .eq("id", documentId);
  }
}

exports.listMyDocuments = async (req, res) => {
  try {
    const userID = req.user.id;
    const { libraryId, workspaceId } = req.query;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    let query = supabase
      .from("documents")
      .select(
        `
        id,
        uploader_id,
        workspace_id,
        library_id,
        title,
        file_size_bytes,
        is_public,
        status,
        ai_reject_reason,
        created_at,
        document_tags (
          assigned_by,
          tags (
            id,
            name
          )
        )
      `
      )
      .eq("uploader_id", userID)
      .is("deleted_at", null);

    if (libraryId) {
      query = query.eq("library_id", libraryId);
    }

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const approvedDocuments = (data || []).filter(
      (document) => String(document.status || "").toUpperCase() === "APPROVED",
    );
    const approvedDocumentIds = approvedDocuments.map((document) => document.id);
    let aiReadyDocumentIds = new Set();

    if (approvedDocumentIds.length > 0) {
      const { data: chunkRows, error: chunkError } = await supabase
        .from("document_chunks")
        .select("document_id")
        .in("document_id", approvedDocumentIds);

      if (chunkError) {
        throw chunkError;
      }

      aiReadyDocumentIds = new Set(
        (chunkRows || []).map((chunk) => String(chunk.document_id)),
      );
    }

    return res.status(200).json({
      status: "success",
      data: approvedDocuments.map((document) => ({
        ...document,
        ai_ready: aiReadyDocumentIds.has(String(document.id)),
      })),
    });
  } catch (error) {
    console.error("Lỗi listMyDocuments:", error);

    return res.status(500).json({
      status: "error",
      message: "Không thể tải danh sách tài liệu.",
      error: error.message,
    });
  }
};

exports.getMyLibraryStorageUsage = async (req, res) => {
  try {
    const userID = req.user.id;
    const { data: documents, error } = await supabase
      .from("documents")
      .select("file_size_bytes")
      .eq("uploader_id", userID)
      .not("library_id", "is", null)
      .is("deleted_at", null);

    if (error) throw error;

    const usedBytes = (documents || []).reduce(
      (total, document) => total + (Number(document.file_size_bytes) || 0),
      0,
    );

    return res.status(200).json({
      status: "success",
      data: {
        usedBytes,
        limitBytes: LIBRARY_STORAGE_LIMIT_BYTES,
        remainingBytes: Math.max(
          0,
          LIBRARY_STORAGE_LIMIT_BYTES - usedBytes,
        ),
      },
    });
  } catch (error) {
    console.error("Get library storage usage error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load library storage usage.",
    });
  }
};

exports.uploadDocuments = async (req, res) => {
  try {
    const userID = req.user.id;
    const files = req.files || [];
    files.forEach((file) => {
      file.originalname = normalizeUploadedFileName(file.originalname);
    });
    const workspaceId = req.body?.workspaceId || null;
    const libraryId = req.body?.libraryId || null; // Hỗ trợ up lên Library
    const tagsString = req.body?.tags || "[]";
    const requestedReplacementIds = parseReplacementDocumentIds(
      req.body?.replacementDocumentIds,
      files.length,
    );

    let userTags = [];
    try {
      const parsed = JSON.parse(tagsString);
      if (Array.isArray(parsed)) {
        userTags = parsed.map(tag => {
          let val = String(tag || "").trim();
          if (!val) return "";
          if (val.startsWith("#")) {
            val = val.substring(1).trim();
          }
          val = val.replace(/\s+/g, "");
          return val;
        }).filter(Boolean);
      }
    } catch (e) {
      console.error("Lỗi parse tags:", e);
    }

    const normalizedTagValues = userTags.map((tag) => tag.toLocaleLowerCase());
    const hasDuplicateTags =
      new Set(normalizedTagValues).size !== normalizedTagValues.length;
    const hasTagStartingWithNumber = userTags.some((tag) => /^\d/.test(tag));

    if (hasDuplicateTags || hasTagStartingWithNumber) {
      return res.status(400).json({
        status: "error",
        code: "TAG_INPUT_INVALID",
        message: hasDuplicateTags
          ? "Tags must be unique."
          : "A tag cannot start with a number.",
      });
    }

    if (files.length === 0) {
      return res.status(400).json({ status: "error", message: "Vui lòng chọn tệp." });
    }

    // CHECK GIỚI HẠN 50MB NẾU UP VÀO WORKSPACE
    const isDirectWorkspaceUpload = Boolean(workspaceId && !libraryId);

    let targetLibrary = null;
    if (libraryId) {
      const { data: lib, error: libErr } = await supabase
        .from("libraries")
        .select("id, user_id, is_public")
        .eq("id", libraryId)
        .maybeSingle();

      if (libErr || !lib) {
        return res.status(404).json({
          status: "error",
          message: "Library not found.",
        });
      }

      if (String(lib.user_id) !== String(userID)) {
        return res.status(403).json({
          status: "error",
          message: "You can only upload documents to your own library.",
        });
      }
      targetLibrary = lib;
    }

    const workspaceAccess = workspaceId
      ? await getWorkspaceDocumentUploadAccess(workspaceId, userID)
      : null;

    if (workspaceAccess && !workspaceAccess.exists) {
      return res.status(404).json({
        status: "error",
        message: "Workspace not found.",
      });
    }

    if (workspaceAccess && !workspaceAccess.canUpload) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can upload documents.",
      });
    }

    let existingDocumentQuery = supabase
      .from("documents")
      .select("id, uploader_id, title, file_size_bytes, created_at")
      .is("deleted_at", null);

    if (!isDirectWorkspaceUpload) {
      existingDocumentQuery = existingDocumentQuery.eq("uploader_id", userID);
    }

    existingDocumentQuery = libraryId
      ? existingDocumentQuery.eq("library_id", libraryId)
      : existingDocumentQuery.is("library_id", null);
    existingDocumentQuery = workspaceId
      ? existingDocumentQuery.eq("workspace_id", workspaceId)
      : existingDocumentQuery.is("workspace_id", null);

    const {
      data: scopedExistingDocuments,
      error: existingDocumentError,
    } = await existingDocumentQuery.order("created_at", { ascending: false });

    if (existingDocumentError) throw existingDocumentError;

    const existingDocumentsById = new Map(
      (scopedExistingDocuments || []).map((document) => [
        String(document.id),
        document,
      ]),
    );
    const unauthorizedReplacementId =
      isDirectWorkspaceUpload && !workspaceAccess?.canReplaceAny
        ? requestedReplacementIds.find((documentId) => {
            if (!documentId) return false;
            const existingDocument = existingDocumentsById.get(
              String(documentId),
            );

            return (
              existingDocument &&
              String(existingDocument.uploader_id) !== String(userID)
            );
          })
        : null;

    if (unauthorizedReplacementId) {
      return res.status(403).json({
        status: "error",
        code: "DOCUMENT_REPLACEMENT_FORBIDDEN",
        message:
          "Only the original uploader or a workspace admin can replace this document.",
      });
    }

    const duplicateDecision = resolveDuplicateUploadDecisions(
      files,
      scopedExistingDocuments || [],
      requestedReplacementIds,
    );

    if (duplicateDecision.conflicts.length > 0) {
      const duplicateConflicts = duplicateDecision.conflicts.map((conflict) => {
        const existingDocument = conflict.documentId
          ? existingDocumentsById.get(String(conflict.documentId))
          : null;

        return {
          ...conflict,
          canReplace:
            !existingDocument ||
            !isDirectWorkspaceUpload ||
            workspaceAccess?.canReplaceAny === true ||
            String(existingDocument.uploader_id) === String(userID),
        };
      });

      return res.status(409).json({
        status: "error",
        code: "DUPLICATE_DOCUMENT",
        message:
          "One or more documents have already been uploaded. Confirm replacement before uploading again.",
        duplicates: duplicateConflicts,
      });
    }

    const replacementDocumentIds = new Set(
      duplicateDecision.replacementTargetIds.flat(),
    );
    const replacementBytes = (scopedExistingDocuments || []).reduce(
      (total, document) =>
        replacementDocumentIds.has(String(document.id))
          ? total + (Number(document.file_size_bytes) || 0)
          : total,
      0,
    );

    const incomingBytes = files.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0,
    );

    if (workspaceId) {
      const { data: existingDocs, error: workspaceStorageError } = await supabase
        .from("documents")
        .select("file_size_bytes")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);

      if (workspaceStorageError) throw workspaceStorageError;

      const currentUsedBytes = (existingDocs || []).reduce((acc, doc) => acc + (Number(doc.file_size_bytes) || 0), 0);

      if (currentUsedBytes + incomingBytes - replacementBytes > LIBRARY_STORAGE_LIMIT_BYTES) {
        return res.status(400).json({
          status: "error",
          message: "Workspace đã đạt giới hạn 50MB dung lượng tải lên.",
        });
      }
    } else if (libraryId) {
      const { data: existingLibraryDocs, error: libraryStorageError } =
        await supabase
          .from("documents")
          .select("file_size_bytes")
          .eq("uploader_id", userID)
          .not("library_id", "is", null)
          .is("deleted_at", null);

      if (libraryStorageError) throw libraryStorageError;

      const currentUsedBytes = (existingLibraryDocs || []).reduce(
        (total, document) =>
          total + (Number(document.file_size_bytes) || 0),
        0,
      );

      if (
        currentUsedBytes + incomingBytes - replacementBytes >
        LIBRARY_STORAGE_LIMIT_BYTES
      ) {
        return res.status(400).json({
          status: "error",
          code: "LIBRARY_STORAGE_LIMIT_EXCEEDED",
          message:
            "Your libraries have reached the shared 50 MB storage limit.",
        });
      }
    }

    // 1. Trích xuất text và chạy kiểm tra nhạy cảm + tag validation song song cho tất cả các file
    let processedFilesData = [];
    if (isDirectWorkspaceUpload) {
      processedFilesData = files.map((file, fileIndex) => ({
        file,
        fileIndex,
        extractedText: "",
        sensitivity: { classification: "APPROVED", word: "", suspicious_text: "" },
        tagValidationResult: { isValid: true, tagValidations: [], aiRecommendedTags: [] },
      }));
    } else {
      try {
        processedFilesData = await mapWithConcurrency(
          files,
          FILE_VALIDATION_CONCURRENCY,
          async (file, fileIndex) => {
            const extractedText = await extractTextFromFile(file);

            const tagValidationResult = await validateTagsAndContent(
              extractedText,
              file.originalname,
              userTags,
            );
            const sensitivity = tagValidationResult.sensitivity || {
              classification: "NONE",
              word: null,
              suspicious_text: null,
            };

            return {
              file,
              fileIndex,
              extractedText,
              sensitivity,
              tagValidationResult,
            };
          },
        );
      } catch (err) {
        console.error("Lỗi song song AI:", err);
        return res.status(500).json({ status: "error", message: "Đã xảy ra lỗi khi kiểm duyệt tài liệu bằng AI." });
      }
    }

    for (const processedData of processedFilesData) {
      if (!processedData.tagValidationResult.isValid) {
        return res.status(400).json({
          status: "error",
          code: "TAG_VALIDATION_FAILED",
          message: `Hashtag kiểm duyệt không hợp lệ cho tài liệu "${processedData.file.originalname}".`,
          tagValidations: processedData.tagValidationResult.tagValidations,
          aiRecommendedTags: processedData.tagValidationResult.aiRecommendedTags
        });
      }
    }

    // 2. Nếu tất cả đều qua kiểm định, tiến hành upload và lưu database
    const tagPromiseCache = new Map();

    function resolveTag(tagName) {
      if (!tagPromiseCache.has(tagName)) {
        tagPromiseCache.set(
          tagName,
          (async () => {
            let { data: tagData } = await supabase
              .from("tags")
              .select("id")
              .eq("name", tagName)
              .maybeSingle();

            if (!tagData) {
              const { data: newTag, error: newTagError } = await supabase
                .from("tags")
                .insert({ name: tagName })
                .select("id")
                .single();

              if (!newTagError) tagData = newTag;
            }

            return tagData;
          })(),
        );
      }

      return tagPromiseCache.get(tagName);
    }

    const uploadedDocuments = await mapWithConcurrency(
      processedFilesData,
      FILE_UPLOAD_CONCURRENCY,
      async (processedData) => {
      const { file, fileIndex, extractedText } = processedData;

      const safeFileName = sanitizeFileName(file.originalname);
      const storagePath = `${userID}/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;

      const targetBucket = BUCKET;

      const { error: uploadError } = await supabase.storage
        .from(targetBucket)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype || "application/octet-stream"
        });

      if (uploadError) throw uploadError;

      // Xác định status và reject reason dựa trên mức độ nhạy cảm
      let status = workspaceId ? "PENDING" : "APPROVED";
      let aiRejectReason = null;

      // Lưu thông tin vào DB, bao gồm cả library_id
      const { data: document, error: insertError } = await supabase
        .from("documents")
        .insert({
          uploader_id: userID,
          workspace_id: workspaceId,
          library_id: libraryId,
          title: file.originalname,
          file_url: storagePath,
          file_size_bytes: file.size,
          is_public: targetLibrary ? Boolean(targetLibrary.is_public) : false,
          status: status,
          ai_reject_reason: aiRejectReason
        })
        .select("*").single();

      if (insertError) throw insertError;

      // Lưu tags vào DB
      // Loại bỏ các tag trùng lặp và làm sạch
      const uniqueTags = [...new Set(userTags.map(t => t.trim().toLowerCase().replace("#", "")))];


      // Gọi hàm xử lý AI (embedding và chunking)
      const shouldKeepReviewStatus = Boolean(workspaceId);
      let aiResult = { status };
      if (isDirectWorkspaceUpload) {
        // The document is already stored as PENDING. Continue extraction,
        // chunking and embeddings without holding the upload
        // response open. processDocumentWithAI records controlled failure
        // states, including PENDING_RETRY.
        void processWorkspaceDocumentInBackground(
          file,
          document.id,
          storagePath,
          userTags,
        ).catch((processingError) => {
          console.error(
            "Background workspace document processing failed:",
            processingError,
          );
        });
      } else {
        aiResult = await processDocumentWithAI(
          file,
          document.id,
          extractedText,
          shouldKeepReviewStatus ? status : null,
          shouldKeepReviewStatus ? aiRejectReason : null
        );
      }

      for (const tagName of uniqueTags) {
        if (!tagName) continue;

        const tagData = await resolveTag(tagName);

        if (tagData && tagData.id) {
          const { error: documentTagInsertError } = await supabase.from("document_tags").insert({
            document_id: document.id,
            tag_id: tagData.id,
            assigned_by: userID
          });

          if (documentTagInsertError) {
            throw documentTagInsertError;
          }
        }
      }

      const { count: finalTagCount, error: finalTagCountError } = await supabase
        .from("document_tags")
        .select("document_id", { count: "exact", head: true })
        .eq("document_id", document.id);

      if (finalTagCountError) {
        throw finalTagCountError;
      }

        const replacedDocumentIds =
          duplicateDecision.replacementTargetIds[fileIndex] || [];

        if (replacedDocumentIds.length > 0 && aiResult.status === "APPROVED") {
          const replacementTimestamp = new Date().toISOString();
          let replacementDeleteQuery = supabase
            .from("documents")
            .update({ deleted_at: replacementTimestamp })
            .in("id", replacedDocumentIds);

          replacementDeleteQuery = workspaceId
            ? replacementDeleteQuery.eq("workspace_id", workspaceId)
            : replacementDeleteQuery.is("workspace_id", null);
          replacementDeleteQuery = libraryId
            ? replacementDeleteQuery.eq("library_id", libraryId)
            : replacementDeleteQuery.is("library_id", null);

          if (!isDirectWorkspaceUpload || !workspaceAccess?.canReplaceAny) {
            replacementDeleteQuery = replacementDeleteQuery.eq(
              "uploader_id",
              userID,
            );
          }

          const { error: replacementDeleteError } =
            await replacementDeleteQuery;

          if (replacementDeleteError) {
            await supabase
              .from("documents")
              .update({ deleted_at: replacementTimestamp })
              .eq("id", document.id);
            throw replacementDeleteError;
          }
        }

        return {
          ...document,
          status: aiResult.status,
          replaced_document_ids: replacedDocumentIds,
        };
      },
    );

    return res.status(201).json({ status: "success", data: uploadedDocuments });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ status: "error", error: error.message });
  }
};

exports.suggestDocumentTags = async (req, res) => {
  try {
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Vui lòng chọn ít nhất một tệp để AI gợi ý tag.",
      });
    }

    const suggestedTagGroups = await mapWithConcurrency(
      files,
      FILE_VALIDATION_CONCURRENCY,
      async (file) => {
        const extractedText = await extractTextFromFile(file);
        const result = await validateTagsAndContent(
          extractedText,
          file.originalname,
          [],
          { throwOnError: true },
        );

        return result.aiRecommendedTags || [];
      },
    );
    const suggestedTags = normalizeSuggestedTags(suggestedTagGroups.flat(), 5);

    return res.status(200).json({
      status: "success",
      data: suggestedTags,
    });
  } catch (error) {
    console.error("Lỗi suggestDocumentTags:", error);
    const errorStatus = Number(error?.status || error?.statusCode);
    const isAiQuotaError = errorStatus === 429;
    const isAiServiceUnavailable = errorStatus === 503;
    const isTemporaryAiError = isAiQuotaError || isAiServiceUnavailable;

    return res.status(isTemporaryAiError ? 503 : 500).json({
      status: "error",
      code: isAiQuotaError
        ? "AI_QUOTA_EXHAUSTED"
        : isAiServiceUnavailable
          ? "AI_SERVICE_UNAVAILABLE"
          : "AI_TAG_SUGGESTION_FAILED",
      message: isAiQuotaError
        ? "AI tag suggestions are temporarily unavailable because the service quota was reached. Please try again later."
        : isAiServiceUnavailable
          ? "AI tag suggestions are temporarily unavailable. Please try again shortly."
          : "AI could not suggest tags for this document.",
    });
  }
};

exports.downloadDocument = async (req, res) => {
  try {
    const userID = req.user.id;
    const { documentId } = req.params;

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy tài liệu.",
      });
    }

    if (!(await canAccessDocument(document, userID))) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không có quyền truy cập tài liệu này.",
      });
    }

    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage.from(BUCKET).createSignedUrl(document.file_url, 300, {
        download: document.title,
      });

    if (signedUrlError) {
      throw signedUrlError;
    }

    if (document.library_id) {
      try {
        await supabase.from("library_downloads").insert({
          library_id: document.library_id,
          user_id: userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" ? null : userID,
        });
      } catch (dlErr) {
        console.warn("Could not log library download:", dlErr);
      }
    }

    return res.status(200).json({
      status: "success",
      data: {
        documentId: document.id,
        fileName: document.title,
        downloadUrl: signedUrlData.signedUrl,
      },
    });
  } catch (error) {
    console.error("Lỗi downloadDocument:", error);

    return res.status(500).json({
      status: "error",
      message: "Không thể tải tài liệu.",
      error: error.message,
    });
  }
};

exports.viewDocument = async (req, res) => {
  try {
    const userID = req.user.id;
    const { documentId } = req.params;

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found.",
      });
    }

    if (
      !(await canAccessDocument(document, userID, {
        workspaceRoles: ["Admin", "Editor"],
        allowWorkspaceUploader: false,
      }))
    ) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to view this document.",
      });
    }

    const primaryBucket = (document.status === "FLAGGED" || document.status === "REJECTED" || document.status === "PENDING_RETRY")
      ? WAITING_BUCKET
      : BUCKET;

    let signedUrlData = null;
    let { data, error: signedUrlError } = await supabase.storage
      .from(primaryBucket)
      .createSignedUrl(document.file_url, 60 * 60);

    if (data?.signedUrl) {
      signedUrlData = data;
    } else {
      const fallbackBucket = primaryBucket === WAITING_BUCKET ? BUCKET : WAITING_BUCKET;
      const { data: fallbackData, error: fallbackError } = await supabase.storage
        .from(fallbackBucket)
        .createSignedUrl(document.file_url, 60 * 60);

      if (fallbackError || !fallbackData?.signedUrl) {
        throw signedUrlError || fallbackError;
      }
      signedUrlData = fallbackData;
    }

    return res.status(200).json({
      status: "success",
      data: {
        documentId: document.id,
        fileName: document.title,
        fileSizeBytes: document.file_size_bytes,
        status: document.status,
        viewUrl: signedUrlData.signedUrl,
        expiresIn: 60 * 60,
      },
    });
  } catch (error) {
    console.error("View document error:", error);

    return res.status(500).json({
      status: "error",
      message: "Could not open document.",
      error: error.message,
    });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const userID = req.user.id;
    const { documentId } = req.params;

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy tài liệu.",
      });
    }

    const isOwner = String(document.uploader_id) === String(userID);
    let isWorkspaceAdmin = false;

    if (!isOwner && document.workspace_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", document.workspace_id)
        .eq("user_id", userID)
        .maybeSingle();

      if (membershipError) throw membershipError;
      isWorkspaceAdmin = String(membership?.role || "").toLowerCase() === "admin";
    }

    if (!isOwner && !isWorkspaceAdmin) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không có quyền xóa tài liệu này.",
      });
    }

    // Xóa file vật lý khỏi Supabase Storage (cả bucket chính và bucket chờ duyệt)
    if (document.file_url) {
      try {
        await supabase.storage.from(BUCKET).remove([document.file_url]);
        await supabase.storage.from(WAITING_BUCKET).remove([document.file_url]);
      } catch (storageErr) {
        console.warn("[deleteDocument] Warning removing file from storage:", storageErr);
      }
    }

    // Xóa dữ liệu vector chunks của tệp tin trong DB
    await supabase
      .from("document_chunks")
      .delete()
      .eq("document_id", documentId);

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (updateError) {
      throw updateError;
    }

    const { error: deleteTagsError } = await supabase
      .from("document_tags")
      .delete()
      .eq("document_id", documentId);

    if (deleteTagsError) {
      throw deleteTagsError;
    }

    return res.status(200).json({
      status: "success",
      message: "Xóa tài liệu thành công.",
    });
  } catch (error) {
    console.error("Lỗi deleteDocument:", error);

    return res.status(500).json({
      status: "error",
      message: "Không thể xóa tài liệu.",
      error: error.message,
    });
  }
};

// Hàm API tạo thư viện mới vào Supabase
exports.createLibrary = async (req, res) => {
  try {
    const { name, description, is_public } = req.body;
    const userID = req.user.id;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    if (userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" || req.user?.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest users cannot create libraries.",
      });
    }

    if (!name || name.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Library name is required.",
      });
    }

    const { count: libraryCount, error: countError } = await supabase
      .from("libraries")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userID);

    if (countError) throw countError;

    if ((libraryCount || 0) >= MAX_LIBRARIES_PER_USER) {
      return res.status(409).json({
        status: "error",
        code: "LIBRARY_LIMIT_REACHED",
        message: `You can create up to ${MAX_LIBRARIES_PER_USER} libraries. Delete an existing library before creating another one.`,
      });
    }

    // Kiểm tra xem người dùng đã có thư viện nào trùng tên chưa (không phân biệt hoa thường)
    const { data: existingLib, error: searchError } = await supabase
      .from("libraries")
      .select("id")
      .eq("user_id", userID)
      .ilike("name", name.trim())
      .maybeSingle();

    if (searchError) throw searchError;

    if (existingLib) {
      return res.status(400).json({
        status: "error",
        message: "Bạn đã có một thư viện khác tên là \"" + name.trim() + "\". Vui lòng chọn tên khác!",
      });
    }

    const { data, error } = await supabase
      .from("libraries")
      .insert({
        user_id: userID,
        name: name.trim(),
        description,
        is_public
      })
      .select().single();

    if (error) throw error;
    return res.status(201).json({ status: "success", data });
  } catch (error) {
    console.error("Create library error:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// Hàm API cập nhật trạng thái của thư viện
exports.updateLibrary = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_public } = req.body;
    const userID = req.user.id;

    if (userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest users cannot update libraries.",
      });
    }

    const { data: targetLib, error: getLibErr } = await supabase
      .from("libraries")
      .select("id, user_id, is_public")
      .eq("id", id)
      .maybeSingle();

    if (getLibErr || !targetLib) {
      return res.status(404).json({
        status: "error",
        message: "Library not found.",
      });
    }

    if (String(targetLib.user_id) !== String(userID)) {
      return res.status(403).json({
        status: "error",
        message: "You can only update your own library.",
      });
    }

    if (targetLib.is_public && is_public === false) {
      return res.status(409).json({
        status: "error",
        code: "PUBLISHED_LIBRARY_CANNOT_BE_PRIVATE",
        message: "A published library cannot be made private again.",
      });
    }

    if (name && name.trim() !== "") {
      const { data: existingLib, error: searchError } = await supabase
        .from("libraries")
        .select("id")
        .eq("user_id", userID)
        .ilike("name", name.trim())
        .neq("id", id)
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingLib) {
        return res.status(400).json({
          status: "error",
          message: "Tên thư viện \"" + name.trim() + "\" đã được sử dụng ở một thư viện khác của bạn.",
        });
      }
    }

    const { data, error } = await supabase
      .from("libraries")
      .update({
        name: name ? name.trim() : undefined,
        description,
        is_public
      })
      .eq("id", id)
      .eq("user_id", userID)
      .select().single();

    if (error) throw error;

    return res.status(200).json({ status: "success", data });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// Hàm API lấy danh sách thư viện của người dùng đăng nhập
exports.listMyLibraries = async (req, res) => {
  try {
    const userID = req.user.id;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    if (userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(200).json({
        status: "success",
        data: [],
      });
    }

    const { data: libraries, error } = await supabase
      .from("libraries")
      .select("*")
      .eq("user_id", userID)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const libraryIds = (libraries || []).map(lib => lib.id);
    const docCountsMap = {};

    if (libraryIds.length > 0) {
      const { data: docs, error: docsError } = await supabase
        .from("documents")
        .select("library_id")
        .in("library_id", libraryIds)
        .is("deleted_at", null);

      if (!docsError && docs) {
        docs.forEach(doc => {
          if (doc.library_id) {
            docCountsMap[doc.library_id] = (docCountsMap[doc.library_id] || 0) + 1;
          }
        });
      }
    }

    const mapped = (libraries || []).map(lib => ({
      ...lib,
      documents: docCountsMap[lib.id] || 0
    }));

    return res.status(200).json({
      status: "success",
      data: mapped,
    });
  } catch (error) {
    console.error("Lỗi listMyLibraries:", error);
    return res.status(500).json({
      status: "error",
      message: "Không thể tải danh sách thư viện cá nhân.",
      error: error.message,
    });
  }
};

// Hàm API lấy thông tin một thư viện cụ thể
exports.getLibrary = async (req, res) => {
  try {
    const { libraryId } = req.params;
    const userID = req.user.id;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    const { data, error } = await supabase
      .from("libraries")
      .select("*")
      .eq("id", libraryId)
      .eq("user_id", userID)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy thư viện.",
      });
    }

    const [{ count: docCount, error: docCountError }, { count: starCount, error: starCountError }, { count: downloadCount, error: downloadCountError }, { data: myStar, error: myStarError }] =
      await Promise.all([
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("library_id", libraryId).is("deleted_at", null),
        supabase.from("library_stars").select("library_id", { count: "exact", head: true }).eq("library_id", libraryId),
        supabase.from("library_downloads").select("id", { count: "exact", head: true }).eq("library_id", libraryId),
        supabase.from("library_stars").select("library_id").eq("library_id", libraryId).eq("user_id", userID).maybeSingle(),
      ]);

    if (docCountError) throw docCountError;
    if (starCountError) throw starCountError;
    if (downloadCountError) throw downloadCountError;
    if (myStarError) throw myStarError;

    const mapped = {
      ...data,
      documents: docCount || 0,
      stars: starCount || 0,
      downloads: downloadCount || 0,
      isStarred: Boolean(myStar),
    };

    return res.status(200).json({
      status: "success",
      data: mapped,
    });
  } catch (error) {
    console.error("Lỗi getLibrary:", error);
    return res.status(500).json({
      status: "error",
      message: "Không thể tải thông tin thư viện.",
      error: error.message,
    });
  }
};

exports.toggleLibraryStar = async (req, res) => {
  try {
    const { libraryId } = req.params;
    const userID = req.user.id;
    const { data: library, error: libraryError } = await supabase
      .from("libraries")
      .select("id, is_public")
      .eq("id", libraryId)
      .maybeSingle();

    if (libraryError) throw libraryError;
    if (!library || !library.is_public) {
      return res.status(404).json({ status: "error", message: "Public library not found." });
    }

    const { data: existing, error: existingError } = await supabase
      .from("library_stars")
      .select("library_id")
      .eq("library_id", libraryId)
      .eq("user_id", userID)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      const { error } = await supabase
        .from("library_stars")
        .delete()
        .eq("library_id", libraryId)
        .eq("user_id", userID);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("library_stars")
        .insert({ library_id: libraryId, user_id: userID });
      if (error) throw error;
    }

    const { count, error: countError } = await supabase
      .from("library_stars")
      .select("library_id", { count: "exact", head: true })
      .eq("library_id", libraryId);

    if (countError) throw countError;
    return res.status(200).json({
      status: "success",
      data: { libraryId, isStarred: !existing, stars: count || 0 },
    });
  } catch (error) {
    console.error("Toggle library star error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update library star.",
      error: error.message,
    });
  }
};

exports.getLibraryEngagement = async (req, res) => {
  try {
    const { libraryId } = req.params;
    const userID = req.user.id;
    const { data: library, error: libraryError } = await supabase
      .from("libraries")
      .select("id, is_public, user_id")
      .eq("id", libraryId)
      .maybeSingle();

    if (libraryError) throw libraryError;
    if (!library || (!library.is_public && String(library.user_id) !== String(userID))) {
      return res.status(404).json({ status: "error", message: "Library not found." });
    }

    const [{ count: stars, error: starsError }, { count: downloads, error: downloadsError }, { data: myStar, error: myStarError }] =
      await Promise.all([
        supabase.from("library_stars").select("library_id", { count: "exact", head: true }).eq("library_id", libraryId),
        supabase.from("library_downloads").select("id", { count: "exact", head: true }).eq("library_id", libraryId),
        supabase.from("library_stars").select("library_id").eq("library_id", libraryId).eq("user_id", userID).maybeSingle(),
      ]);

    if (starsError) throw starsError;
    if (downloadsError) throw downloadsError;
    if (myStarError) throw myStarError;

    return res.status(200).json({
      status: "success",
      data: {
        libraryId,
        stars: stars || 0,
        downloads: downloads || 0,
        isStarred: Boolean(myStar),
      },
    });
  } catch (error) {
    console.error("Get library engagement error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load library engagement.",
      error: error.message,
    });
  }
};

// Hàm API xóa thư viện
exports.deleteLibrary = async (req, res) => {
  try {
    const { id } = req.params;
    const userID = req.user.id;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    if (userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest users cannot delete libraries.",
      });
    }

    const { data: targetLib, error: findLibErr } = await supabase
      .from("libraries")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (findLibErr) throw findLibErr;

    if (!targetLib) {
      return res.status(404).json({
        status: "error",
        message: "Library not found.",
      });
    }

    if (String(targetLib.user_id) !== String(userID)) {
      return res.status(403).json({
        status: "error",
        message: "You can only delete your own library.",
      });
    }

    // Attempt RPC call first
    let rpcSuccess = false;
    try {
      const { error: rpcError } = await supabase.rpc("delete_owned_library", {
        p_library_id: id,
        p_user_id: userID,
      });

      if (rpcError) {
        if (String(rpcError.message).includes("LIBRARY_NOT_FOUND")) {
          return res.status(404).json({
            status: "error",
            message: "Library not found.",
          });
        }
        if (String(rpcError.message).includes("LIBRARY_OWNER_REQUIRED")) {
          return res.status(403).json({
            status: "error",
            message: "You can only delete your own library.",
          });
        }
        if (
          !String(rpcError.message).includes("schema cache") &&
          !String(rpcError.message).includes("Could not find the function")
        ) {
          console.warn("RPC delete_owned_library failed, falling back to direct queries:", rpcError.message);
        }
      } else {
        rpcSuccess = true;
      }
    } catch (rpcErr) {
      if (
        !String(rpcErr?.message).includes("schema cache") &&
        !String(rpcErr?.message).includes("Could not find the function")
      ) {
        console.warn("RPC delete_owned_library threw exception, falling back to direct queries:", rpcErr.message);
      }
    }

    // Fallback if RPC fails or is missing on backend database
    if (!rpcSuccess) {
      await supabase.from("library_stars").delete().eq("library_id", id);
      await supabase.from("library_downloads").delete().eq("library_id", id);
      await supabase
        .from("documents")
        .update({ library_id: null, is_public: false })
        .eq("library_id", id);

      const { error: deleteLibError } = await supabase
        .from("libraries")
        .delete()
        .eq("id", id)
        .eq("user_id", userID);

      if (deleteLibError) throw deleteLibError;
    }

    return res.status(200).json({
      status: "success",
      message: "Xóa thư viện thành công.",
    });
  } catch (error) {
    console.error("Lỗi deleteLibrary:", error);
    return res.status(500).json({
      status: "error",
      message: "Không thể xóa thư viện.",
      error: error.message,
    });
  }
};

// Hàm API toggle thả sao cho Thư viện (lưu trực tiếp vào bảng library_stars)
exports.toggleStarLibrary = async (req, res) => {
  try {
    const { libraryId } = req.params;
    const userID = req.user.id;

    if (userID === "guest" || userID === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Tài khoản Guest không hỗ trợ thả sao thư viện.",
      });
    }

    const { data: existing } = await supabase
      .from("library_stars")
      .select("library_id")
      .eq("library_id", libraryId)
      .eq("user_id", userID)
      .maybeSingle();

    let isStarred = false;

    if (existing) {
      await supabase
        .from("library_stars")
        .delete()
        .eq("library_id", libraryId)
        .eq("user_id", userID);
      isStarred = false;
    } else {
      await supabase
        .from("library_stars")
        .insert({ library_id: libraryId, user_id: userID });
      isStarred = true;
    }

    const { count } = await supabase
      .from("library_stars")
      .select("*", { count: "exact", head: true })
      .eq("library_id", libraryId);

    return res.status(200).json({
      status: "success",
      data: {
        libraryId,
        isStarred,
        stars: count || 0,
      },
    });
  } catch (error) {
    console.error("Lỗi toggleStarLibrary:", error);
    return res.status(500).json({
      status: "error",
      message: "Không thể thay đổi trạng thái sao cho thư viện.",
      error: error.message,
    });
  }
};
