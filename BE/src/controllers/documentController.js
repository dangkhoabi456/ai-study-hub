const crypto = require("crypto");
const path = require("path");
const supabase = require("../config/supabase");

const {
  extractTextFromFile,
  splitTextIntoChunks,
} = require("../services/textExtractService");

const {
  moderateDocument,
  createEmbedding,
  toVectorLiteral,
  checkSensitiveContent,
  validateTagsAndContent,
} = require("../services/aiService");

const BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "documents";
const { createActivityLog } = require("../services/activityLogService");

function sanitizeFileName(fileName) {
  const baseName = path.basename(fileName || "upload.bin");

  return baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

async function processDocumentWithAI(file, documentId, preExtractedText = null, overrideStatus = null, overrideRejectReason = null) {
  try {
    console.log("Starting AI processing for document:", documentId);

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

    if (!overrideStatus) {
      const moderation = await moderateDocument(extractedText);

      if (moderation.status === "REJECTED") {
        await supabase
          .from("documents")
          .update({ status: "REJECTED", ai_reject_reason: moderation })
          .eq("id", documentId);

        return { status: "REJECTED", reason: moderation.reason, chunkCount: 0 };
      }
    }


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

      const chunkRows = await Promise.all(
        chunks.map(async (chunk, index) => {
          const embedding = await createEmbedding(chunk, "document");
          return {
            document_id: documentId,
            chunk_index: index,
            content: chunk,
            embedding: toVectorLiteral(embedding),
          };
        })
      );

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

      console.log("AI processing completed for document:", documentId);

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

    return res.status(200).json({
      status: "success",
      data: data || [],
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

exports.uploadDocuments = async (req, res) => {
  try {
    const userID = req.user.id;
    const files = req.files || [];
    const workspaceId = req.body?.workspaceId || null;
    const libraryId = req.body?.libraryId || null; // Hỗ trợ up lên Library
    const tagsString = req.body?.tags || "[]";

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

    console.log("[uploadDocuments] userTags received:", userTags);

    if (files.length === 0) {
      return res.status(400).json({ status: "error", message: "Vui lòng chọn tệp." });
    }

    // CHECK GIỚI HẠN 50MB NẾU UP VÀO WORKSPACE
    if (workspaceId) {
      const { data: existingDocs } = await supabase
        .from("documents")
        .select("file_size_bytes")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);

      const currentUsedBytes = (existingDocs || []).reduce((acc, doc) => acc + (Number(doc.file_size_bytes) || 0), 0);
      const incomingBytes = files.reduce((acc, file) => acc + file.size, 0);

      if (currentUsedBytes + incomingBytes > 50 * 1024 * 1024) {
        return res.status(400).json({
          status: "error",
          message: "Workspace đã đạt giới hạn 50MB dung lượng tải lên."
        });
      }
    }

    // 1. Trích xuất text và chạy kiểm tra nhạy cảm + tag validation song song cho tất cả các file
    let processedFilesData = [];
    try {
      processedFilesData = await Promise.all(
        files.map(async (file) => {
          const extractedText = await extractTextFromFile(file);

          // Chạy song song kiểm tra nhạy cảm và kiểm duyệt tag để giảm thời gian xử lý (tối ưu hóa hiệu năng)
          const [sensitivity, tagValidationResult] = await Promise.all([
            checkSensitiveContent(extractedText),
            validateTagsAndContent(extractedText, file.originalname, userTags),
          ]);

          return {
            file,
            extractedText,
            sensitivity,
            tagValidationResult,
          };
        })
      );
    } catch (err) {
      console.error("Lỗi song song AI:", err);
      return res.status(500).json({ status: "error", message: "Đã xảy ra lỗi khi kiểm duyệt tài liệu bằng AI." });
    }

    // 2. Tiến hành upload và lưu database
    const uploadedDocuments = [];

    for (const processedData of processedFilesData) {
      const { file, extractedText, sensitivity, tagValidationResult } = processedData;

      const safeFileName = sanitizeFileName(file.originalname);
      const storagePath = `${userID}/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype || "application/octet-stream"
        });

      if (uploadError) throw uploadError;

      // Xác định status và reject reason dựa trên mức độ nhạy cảm
      let status = workspaceId ? "PENDING" : "APPROVED";
      let aiRejectReason = null;

      if (sensitivity.classification === "SEVERE" || sensitivity.classification === "MILD") {
        status = "FLAGGED";
        aiRejectReason = {
          reason: `Contains ${sensitivity.classification.toLowerCase()} inappropriate language`,
          word: sensitivity.word,
          classification: sensitivity.classification
        };
      }

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
          is_public: libraryId ? true : false,
          status: status,
          ai_reject_reason: aiRejectReason
        })
        .select("*").single();

      if (insertError) throw insertError;

      // Nếu tài liệu bị gắn cờ nhạy cảm, log activity để thông báo cho admin
      if (status === "FLAGGED") {
        await createActivityLog({
          actorUserId: userID,
          actionType: "FILE_FLAGGED",
          entityType: "document",
          entityId: document.id,
          newData: {
            reason: "AI detected sensitive language",
            word: sensitivity.word,
            classification: sensitivity.classification,
            fileName: file.originalname
          },
          request: req,
          riskLevel: "HIGH",
          details: `AI flagged ${file.originalname} for sensitive language.`,
        });
      }

      // Lưu tags vào DB
      // Lấy các tag hợp lệ hoặc tag thay thế được AI gợi ý
      const correctedUserTags = (tagValidationResult.tagValidations || []).map(v => {
        return v.recommendedReplacement || v.tag;
      });

      // Lấy 3 tag AI tự động gợi ý cho tài liệu
      const aiTags = tagValidationResult.aiRecommendedTags || [];

      // Gộp lại, lọc trùng và làm sạch
      const allFileTags = [...correctedUserTags, ...aiTags];
      const uniqueTags = [
        ...new Set(
          allFileTags
            .map(t => String(t || "").trim().toLowerCase().replace("#", ""))
            .filter(Boolean)
        )
      ];
      console.log(`[uploadDocuments] final tag names for ${file.originalname}:`, uniqueTags);


      // Gọi hàm xử lý AI (embedding và chunking)
      const aiResult = await processDocumentWithAI(
        file,
        document.id,
        extractedText,
        status,
        aiRejectReason
      );

      for (const tagName of uniqueTags) {
        if (!tagName) continue;

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
          if (!newTagError) {
            tagData = newTag;
          }
        }

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

      // Lấy danh sách tags dạng objects để trả về kèm document cho Frontend hiển thị tức thì
      const { data: finalDocTags } = await supabase
        .from("document_tags")
        .select("tags ( name )")
        .eq("document_id", document.id);

      uploadedDocuments.push({
        ...document,
        status: aiResult.status,
        document_tags: finalDocTags || []
      });
    }

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

    const suggestedTags = [];

    for (const file of files) {
      const extractedText = await extractTextFromFile(file);
      const result = await validateTagsAndContent(
        extractedText,
        file.originalname,
        [],
      );

      for (const tag of result.aiRecommendedTags || []) {
        const normalizedTag = String(tag || "").trim();
        if (
          normalizedTag &&
          !suggestedTags.some(
            (existingTag) =>
              existingTag.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase(),
          )
        ) {
          suggestedTags.push(normalizedTag.startsWith("#") ? normalizedTag : `#${normalizedTag}`);
        }
      }
    }

    return res.status(200).json({
      status: "success",
      data: suggestedTags.slice(0, 5),
    });
  } catch (error) {
    console.error("Lỗi suggestDocumentTags:", error);
    return res.status(500).json({
      status: "error",
      message: "AI không thể gợi ý tag cho tài liệu này.",
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

    const isOwner = String(document.uploader_id) === String(userID);

    if (!isOwner && document.is_public !== true) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không có quyền truy cập tài liệu này.",
      });
    }

    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage.from(BUCKET).createSignedUrl(document.file_url, 60, {
        download: document.title,
      });

    if (signedUrlError) {
      throw signedUrlError;
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

    const isOwner = String(document.uploader_id) === String(userID);

    if (!isOwner && document.is_public !== true) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to view this document.",
      });
    }

    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage.from(BUCKET).createSignedUrl(document.file_url, 60 * 60);

    if (signedUrlError) {
      throw signedUrlError;
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
    const { name, description, is_public, share_on_profile } = req.body;
    const userID = req.user.id;

    if (!userID) {
      return res.status(401).json({
        status: "error",
        message: "Authenticated user id is missing.",
      });
    }

    if (!name || name.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Library name is required.",
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
        is_public,
        share_on_profile
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
    const { name, description, is_public, share_on_profile } = req.body;
    const userID = req.user.id;

    if (name && name.trim() !== "") {
      // Kiểm tra trùng tên với các thư viện khác cùng user (trừ thư viện hiện tại đang sửa)
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
        is_public,
        share_on_profile
      })
      .eq("id", id)
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

    const { data, error } = await supabase
      .from("libraries")
      .select("*, documents(count)")
      .eq("user_id", userID)
      .is("documents.deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const mapped = (data || []).map(lib => ({
      ...lib,
      documents: lib.documents?.[0]?.count || 0
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
      .select("*, documents(count)")
      .eq("id", libraryId)
      .eq("user_id", userID)
      .is("documents.deleted_at", null)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy thư viện.",
      });
    }

    const mapped = {
      ...data,
      documents: data.documents?.[0]?.count || 0
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

    const { error } = await supabase
      .from("libraries")
      .delete()
      .eq("id", id)
      .eq("user_id", userID);

    if (error) throw error;

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

exports.suggestTagsForFile = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ status: "error", message: "No file uploaded." });
    }

    const extractedText = await extractTextFromFile(file);
    const tagValidationResult = await validateTagsAndContent(extractedText, file.originalname, []);

    return res.status(200).json({
      status: "success",
      tags: tagValidationResult.aiRecommendedTags || []
    });
  } catch (error) {
    console.error("Lỗi suggestTagsForFile:", error);
    return res.status(500).json({ status: "error", message: "Failed to generate suggested tags." });
  }
};
