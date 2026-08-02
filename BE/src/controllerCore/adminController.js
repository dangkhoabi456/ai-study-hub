const supabase = require("../config/supabase");
const { createActivityLog } = require("../services/activityLogService");
const { MAX_OWNED_WORKSPACES, countActiveOwnedWorkspaces } = require("../services/workspaceLimitService");
const { notifyWorkspaceMembers } = require("./workspaceController");
const crypto = require("crypto");
const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "documents";
const WAITING_BUCKET = process.env.SUPABASE_DOCUMENT_WAITING_ADMIN_APPROVED || "document_waiting_admin";

const WAITING_DOCUMENT_STATUSES = new Set(["FLAGGED", "REJECTED", "PENDING_RETRY"]);

function getDocumentBucket(document) {
  return WAITING_DOCUMENT_STATUSES.has(String(document.status || "").toUpperCase())
    ? WAITING_BUCKET
    : DOCUMENT_BUCKET;
}

function chunkArray(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function removeWorkspaceStorageFiles(documents) {
  const pathsByBucket = new Map();
  for (const document of documents) {
    const path = String(document.file_url || "").trim();
    if (!path) continue;
    const bucket = getDocumentBucket(document);
    if (!pathsByBucket.has(bucket)) pathsByBucket.set(bucket, new Set());
    pathsByBucket.get(bucket).add(path);
  }

  for (const [bucket, paths] of pathsByBucket) {
    for (const batch of chunkArray([...paths])) {
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        throw new Error(`Storage cleanup failed for bucket "${bucket}": ${error.message}`);
      }
    }
  }
}

async function getWorkspaceForPurge(workspaceId) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, deleted_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getWorkspaceDocuments(workspaceId) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, file_url, file_size_bytes, status, workspace_id, library_id, deleted_at")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return data || [];
}

async function countRows(table, filter) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  query = filter(query);
  const { count, error } = await query;
  // The discussion tables were introduced incrementally. A preview remains useful
  // on older deployments where an optional relation or filter column does not exist.
  if (error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) {
    return 0;
  }
  if (error) throw error;
  return count || 0;
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(query.pageSize, 10) || 100),
  );

  return {
    page,
    pageSize,
    from: (page - 1) * pageSize,
    to: page * pageSize - 1,
  };
}

function paginationPayload(count, page, pageSize) {
  return {
    page,
    pageSize,
    totalItems: count || 0,
    totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  };
}

exports.getDashboardStats = async (req, res) => {
  try {
    const today = getTodayDate();

    const { count: totalUsers, error: userError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (userError) throw userError;

    const { count: totalDocuments, error: documentError } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);

    if (documentError) throw documentError;

    const { count: pendingModeration, error: moderationError } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .in("status", ["REJECTED", "FLAGGED", "PENDING_RETRY"])
      .is("deleted_at", null);

    if (moderationError) throw moderationError;

    const { data: quotaRows, error: quotaError } = await supabase
      .from("daily_quota_usage")
      .select("bytes_uploaded, bytes_downloaded")
      .eq("usage_date", today);

    if (quotaError) throw quotaError;

    const totalBytesUploadedToday = (quotaRows || []).reduce(
      (sum, row) => sum + Number(row.bytes_uploaded || 0),
      0
    );

    const totalBytesDownloadedToday = (quotaRows || []).reduce(
      (sum, row) => sum + Number(row.bytes_downloaded || 0),
      0
    );

    const { data: aiRows, error: aiError } = await supabase
      .from("ai_usage_logs")
      .select("tokens_consumed, chat_count")
      .eq("usage_date", today);

    if (aiError) throw aiError;

    const totalAiChatsToday = (aiRows || []).reduce(
      (sum, row) => sum + Number(row.chat_count || 0),
      0
    );

    const totalTokensToday = (aiRows || []).reduce(
      (sum, row) => sum + Number(row.tokens_consumed || 0),
      0
    );

    return res.status(200).json({
      status: "success",
      data: {
        totalUsers: totalUsers || 0,
        totalDocuments: totalDocuments || 0,
        pendingModeration: pendingModeration || 0,
        totalBytesUploadedToday,
        totalBytesDownloadedToday,
        totalAiChatsToday,
        totalTokensToday,
      },
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load admin dashboard.",
      error: error.message,
    });
  }
};

exports.getModerationDocuments = async (req, res) => {
  try {
    const { page, pageSize, from, to } = getPagination(req.query);
    const search = String(req.query.search || "").trim();
    const requestedStatus = String(req.query.status || "").toUpperCase();
    const allowedStatuses = ["REJECTED", "FLAGGED", "PENDING_RETRY"];
    let query = supabase
      .from("documents")
      .select(`
        id,
        uploader_id,
        title,
        file_url,
        file_size_bytes,
        is_public,
        status,
        ai_reject_reason,
        reviewed_by_admin_id,
        reviewed_at,
        admin_review_reason,
        created_at,
        uploader:profiles!documents_uploader_id_fkey (
          id,
          email,
          username,
          full_name
        )
      `, { count: "exact" })
      .in(
        "status",
        allowedStatuses.includes(requestedStatus)
          ? [requestedStatus]
          : allowedStatuses,
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search) query = query.ilike("title", `%${search}%`);

    const { data, error, count } = await query;

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: data || [],
      pagination: paginationPayload(count, page, pageSize),
    });
  } catch (error) {
    console.error("Admin moderation list error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load moderation documents.",
      error: error.message,
    });
  }
};

exports.reviewDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { decision, reason } = req.body;

    if (!["APPROVE", "KEEP_REJECTED"].includes(decision)) {
      return res.status(400).json({
        status: "error",
        message: "decision must be APPROVE or KEEP_REJECTED.",
      });
    }

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        status: "error",
        message: "Admin review reason is required.",
      });
    }

    const { data: oldDocument, error: fetchError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!["FLAGGED", "PENDING"].includes(oldDocument.status)) {
      return res.status(400).json({
        status: "error",
        message: "Only documents pending moderation can be reviewed.",
      });
    }

    const reviewedAt = new Date().toISOString();
    const reviewReason = String(reason).trim();
    let updatedDocument;

    if (decision === "APPROVE") {
      // Transfer file from WAITING_BUCKET to DOCUMENT_BUCKET if present in WAITING_BUCKET
      if (oldDocument.file_url && oldDocument.status === "FLAGGED") {
        try {
          const { data: fileBlob, error: downloadErr } = await supabase.storage
            .from(WAITING_BUCKET)
            .download(oldDocument.file_url);

          if (downloadErr || !fileBlob) {
            throw downloadErr || new Error("Failed to download file from WAITING_BUCKET");
          }

          const arrayBuffer = await fileBlob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const { error: uploadErr } = await supabase.storage
            .from(DOCUMENT_BUCKET)
            .upload(oldDocument.file_url, buffer, {
              contentType: "application/octet-stream",
              upsert: true,
            });

          if (uploadErr) throw uploadErr;

          await supabase.storage
            .from(WAITING_BUCKET)
            .remove([oldDocument.file_url]);
        } catch (transferErr) {
          console.error("Storage transfer failed during document approval:", transferErr);
          return res.status(500).json({
            status: "error",
            message: "Could not approve document: Storage file transfer failed.",
            error: transferErr.message,
          });
        }
      }

      const { data, error: updateError } = await supabase
        .from("documents")
        .update({
          status: "APPROVED",
          reviewed_by_admin_id: req.user.id,
          reviewed_at: reviewedAt,
          admin_review_reason: reviewReason,
        })
        .eq("id", documentId)
        .select("*")
        .single();

      if (updateError) throw updateError;
      updatedDocument = data;
    } else {
      if (oldDocument.file_url) {
        await supabase.storage
          .from(WAITING_BUCKET)
          .remove([oldDocument.file_url]);

        await supabase.storage
          .from(DOCUMENT_BUCKET)
          .remove([oldDocument.file_url]);
      }

      await supabase.from("document_chunks").delete().eq("document_id", documentId);
      await supabase.from("document_tags").delete().eq("document_id", documentId);

      const { data, error: updateError } = await supabase
        .from("documents")
        .update({
          status: "REJECTED",
          deleted_at: reviewedAt,
          reviewed_by_admin_id: req.user.id,
          reviewed_at: reviewedAt,
          admin_review_reason: reviewReason,
        })
        .eq("id", documentId)
        .select("*")
        .single();

      if (updateError) throw updateError;
      updatedDocument = data;
    }

    await createActivityLog({
      actorUserId: req.user.id,
      adminId: req.user.id,
      actionType: "ADMIN_REVIEW_DOCUMENT",
      entityType: "documents",
      entityId: documentId,
      oldData: oldDocument,
      newData: updatedDocument,
      request: req,
      riskLevel: decision === "APPROVE" ? "MEDIUM" : "HIGH",
      details: `Admin (ID: ${req.user.id}) ${decision === "APPROVE" ? "approved" : "rejected"} document "${oldDocument.title}". Review note: ${reviewReason}`,
    });

    await createActivityLog({
      actorUserId: oldDocument.uploader_id,
      adminId: req.user.id,
      actionType:
        decision === "APPROVE" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
      entityType: "documents",
      entityId: documentId,
      oldData: oldDocument,
      newData: {
        notificationType:
          decision === "APPROVE" ? "moderationApproved" : "moderationRejected",
        documentTitle: oldDocument.title,
        libraryId: oldDocument.library_id,
        reviewedByAdminId: req.user.id,
        reviewedAt,
      },
      request: req,
      riskLevel: decision === "APPROVE" ? "INFO" : "MEDIUM",
      details:
        decision === "APPROVE"
          ? `Your document "${oldDocument.title}" has been approved by admin and is now available in your library.`
          : `Your document "${oldDocument.title}" was rejected by admin. Reason: ${reviewReason}`,
    });

    return res.status(200).json({
      status: "success",
      message:
        decision === "APPROVE"
          ? "Document approved and moved to main library storage."
          : "Document rejected and removed.",
      data: updatedDocument,
    });
  } catch (error) {
    console.error("Admin reviewDocument error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not process document review decision.",
      error: error.message,
    });
  }
};

exports.viewModerationDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (docError) throw docError;

    if (!document) {
      return res.status(404).json({ status: "error", message: "Document not found." });
    }

    const primaryBucket = (document.status === "FLAGGED" || document.status === "REJECTED" || document.status === "PENDING_RETRY")
      ? WAITING_BUCKET
      : DOCUMENT_BUCKET;

    let signedUrlData = null;
    let { data, error: signedUrlError } = await supabase.storage
      .from(primaryBucket)
      .createSignedUrl(document.file_url, 60 * 60);

    if (data?.signedUrl) {
      signedUrlData = data;
    } else {
      const fallbackBucket = primaryBucket === WAITING_BUCKET ? DOCUMENT_BUCKET : WAITING_BUCKET;
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
        expiresIn: 3600
      }
    });
  } catch (error) {
    console.error("viewModerationDocument error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not fetch moderation document preview URL.",
      error: error.message
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const { page, pageSize, from, to } = getPagination(req.query);
    const status = String(req.query.status || "").toUpperCase();
    const role = String(req.query.role || "").toUpperCase();
    const sortBy = String(req.query.sortBy || "last-active");
    const sortColumn =
      sortBy === "name"
        ? "full_name"
        : sortBy === "created"
          ? "created_at"
          : "last_login_at";

    let query = supabase
      .from("profiles")
      .select(`
        id,
        email,
        username,
        full_name,
        role,
        status,
        created_at,
        updated_at,
        last_login_at
      `, { count: "exact" })
      .order(sortColumn, { ascending: sortBy === "name", nullsFirst: false })
      .range(from, to);

    if (search) {
      query = query.or(
        `username.ilike.%${search}%,email.ilike.%${search}%,full_name.ilike.%${search}%`,
      );
    }
    if (["ACTIVE", "DISABLED"].includes(status)) query = query.eq("status", status);
    if (role) query = query.eq("role", role);

    const { data, error, count } = await query;

    if (error) throw error;

    const userIds = (data || []).map((user) => user.id);

    const [
      { data: workspaceRows, error: workspaceError },
      { data: libraryRows, error: libraryError },
      { data: documentRows, error: documentStorageError },
    ] = await Promise.all([
      userIds.length
        ? supabase
            .from("workspace_members")
            .select("user_id")
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
            .from("libraries")
            .select("user_id")
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
            .from("documents")
            .select("uploader_id, file_size_bytes")
            .in("uploader_id", userIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (workspaceError) throw workspaceError;
    if (libraryError) throw libraryError;
    if (documentStorageError) throw documentStorageError;

    const workspaceCounts = new Map();
    (workspaceRows || []).forEach((row) => {
      workspaceCounts.set(
        row.user_id,
        (workspaceCounts.get(row.user_id) || 0) + 1,
      );
    });

    const libraryCounts = new Map();
    (libraryRows || []).forEach((row) => {
      libraryCounts.set(row.user_id, (libraryCounts.get(row.user_id) || 0) + 1);
    });

    const storageTotals = new Map();
    (documentRows || []).forEach((row) => {
      storageTotals.set(
        row.uploader_id,
        (storageTotals.get(row.uploader_id) || 0) +
          Number(row.file_size_bytes || 0),
      );
    });

    return res.status(200).json({
      status: "success",
      data: (data || []).map((user) => ({
        ...user,
        workspace_count: workspaceCounts.get(user.id) || 0,
        library_count: libraryCounts.get(user.id) || 0,
        storage_used_bytes: storageTotals.get(user.id) || 0,
        storage_quota_bytes: 50 * 1024 * 1024,
      })),
      pagination: paginationPayload(count, page, pageSize),
    });
  } catch (error) {
    console.error("Admin get users error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load users.",
      error: error.message,
    });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;

    if (!["ACTIVE", "DISABLED"].includes(status)) {
      return res.status(400).json({
        status: "error",
        message: "status must be ACTIVE or DISABLED.",
      });
    }

    if (String(userId) === String(req.user.id) && status === "DISABLED") {
      return res.status(400).json({
        status: "error",
        message: "Admin cannot disable their own account.",
      });
    }

    const { data: oldUser, error: fetchError } = await supabase
      .from("profiles")
      .select("id, email, username, full_name, role, status, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!oldUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (status === "DISABLED" && oldUser.role === "ADMIN") {
      const { count: activeAdminCount } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "ADMIN")
        .eq("status", "ACTIVE");

      if ((activeAdminCount || 0) <= 1) {
        return res.status(400).json({
          status: "error",
          message: "Cannot disable the last active System Admin.",
        });
      }
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("profiles")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id, email, username, full_name, role, status, created_at, updated_at")
      .single();

    if (updateError) throw updateError;

    await createActivityLog({
      actorUserId: req.user.id,
      actionType: "ADMIN_UPDATE_USER_STATUS",
      entityType: "profiles",
      entityId: userId,
      oldData: oldUser,
      newData: {
        ...updatedUser,
        admin_reason: reason || null,
      },
      request: req,
      riskLevel: status === "DISABLED" ? "HIGH" : "MEDIUM",
      details: reason || `Account status changed to ${status}.`,
    });

    return res.status(200).json({
      status: "success",
      message: "User status updated.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Admin update user status error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update user status.",
      error: error.message,
    });
  }
};

exports.getActivityLogs = async (req, res) => {
  try {
    const { page, pageSize, from, to } = getPagination(req.query);
    const action = String(req.query.action || "").trim();
    const actorUserId = String(req.query.userId || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    let query = supabase
      .from("activity_logs")
      .select(`
        id,
        user_id,
        admin_id,
        action_type,
        entity_type,
        entity_id,
        old_data,
        new_data,
        risk_level,
        details,
        created_at,
        actor:profiles!activity_logs_user_id_fkey (
          id,
          email,
          username,
          full_name
        ),
        admin:profiles!activity_logs_admin_id_fkey (
          id,
          email,
          username,
          full_name
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (action) query = query.eq("action_type", action);
    if (actorUserId) query = query.eq("user_id", actorUserId);
    if (startDate) query = query.gte("created_at", startDate);
    if (endDate) query = query.lte("created_at", `${endDate}T23:59:59.999Z`);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: data || [],
      pagination: paginationPayload(count, page, pageSize),
    });
  } catch (error) {
    console.error("Admin activity logs error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load activity logs.",
      error: error.message,
    });
  }
};

exports.getUsage = async (req, res) => {
  try {
    const { page, pageSize, from, to } = getPagination(req.query);
    const userId = String(req.query.userId || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    let quotaQuery = supabase
      .from("daily_quota_usage")
      .select(`
        id,
        user_id,
        usage_date,
        bytes_uploaded,
        bytes_downloaded,
        user:profiles!daily_quota_usage_user_id_fkey (
          id,
          email,
          username,
          full_name
        )
      `, { count: "exact" })
      .order("usage_date", { ascending: false })
      .range(from, to);

    if (userId) quotaQuery = quotaQuery.eq("user_id", userId);
    if (startDate) quotaQuery = quotaQuery.gte("usage_date", startDate);
    if (endDate) quotaQuery = quotaQuery.lte("usage_date", endDate);

    let aiQuery = supabase
      .from("ai_usage_logs")
      .select(`
        id,
        user_id,
        usage_date,
        tokens_consumed,
        chat_count,
        user:profiles!ai_usage_logs_user_id_fkey (
          id,
          email,
          username,
          full_name
        )
      `, { count: "exact" })
      .order("usage_date", { ascending: false })
      .range(from, to);

    if (userId) aiQuery = aiQuery.eq("user_id", userId);
    if (startDate) aiQuery = aiQuery.gte("usage_date", startDate);
    if (endDate) aiQuery = aiQuery.lte("usage_date", endDate);

    const [
      { data: quotaUsage, error: quotaError, count: quotaCount },
      { data: aiUsage, error: aiError, count: aiCount },
    ] = await Promise.all([quotaQuery, aiQuery]);

    if (quotaError) throw quotaError;
    if (aiError) throw aiError;

    return res.status(200).json({
      status: "success",
      data: {
        quotaUsage: quotaUsage || [],
        aiUsage: aiUsage || [],
      },
      pagination: {
        page,
        pageSize,
        quotaItems: quotaCount || 0,
        aiItems: aiCount || 0,
        totalPages: Math.max(
          1,
          Math.ceil(Math.max(quotaCount || 0, aiCount || 0) / pageSize),
        ),
      },
    });
  } catch (error) {
    console.error("Admin usage error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load usage data.",
      error: error.message,
    });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const role = String(req.body.role || "").toUpperCase();
    const reason = String(req.body.reason || "").trim();

    if (!["USER", "SYSTEM_ADMIN"].includes(role)) {
      return res.status(400).json({
        status: "error",
        message: "role must be USER or SYSTEM_ADMIN.",
      });
    }

    if (String(userId) === String(req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "Administrators cannot change their own system role.",
      });
    }

    const { data: oldUser, error: fetchError } = await supabase
      .from("profiles")
      .select("id, email, username, full_name, role, status, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!oldUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    if (oldUser.role === "SYSTEM_ADMIN" && role !== "SYSTEM_ADMIN") {
      const { count, error: countError } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "SYSTEM_ADMIN")
        .neq("status", "DISABLED");

      if (countError) throw countError;
      if ((count || 0) <= 1) {
        return res.status(400).json({
          status: "error",
          message: "The final active System Admin cannot be demoted.",
        });
      }
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("profiles")
      .update({
        role,
        session_id: crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id, email, username, full_name, role, status, created_at, updated_at, last_login_at")
      .single();

    if (updateError) throw updateError;

    await createActivityLog({
      actorUserId: req.user.id,
      actionType: "ADMIN_UPDATE_USER_ROLE",
      entityType: "profiles",
      entityId: userId,
      oldData: oldUser,
      newData: { ...updatedUser, admin_reason: reason || null },
      request: req,
      riskLevel: "HIGH",
      details: reason || `System role changed to ${role}.`,
    });

    return res.status(200).json({
      status: "success",
      message: "User role updated.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Admin update user role error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update user role.",
      error: error.message,
    });
  }
};

exports.getDeletedWorkspaces = async (req, res) => {
  try {
    const { data: workspaces, error } = await supabase
      .from("workspaces")
      .select("id, name, description, created_by, created_at, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw error;

    const rows = await Promise.all((workspaces || []).map(async (workspace) => {
      const documents = await getWorkspaceDocuments(workspace.id);
      const reclaimable = documents.filter((document) => !document.library_id);
      return {
        ...workspace,
        documentCount: documents.length,
        preservedDocumentCount: documents.length - reclaimable.length,
        reclaimableBytes: reclaimable.reduce((total, document) => total + Number(document.file_size_bytes || 0), 0),
      };
    }));

    return res.status(200).json({ status: "success", data: rows });
  } catch (error) {
    console.error("Admin deleted workspaces error:", error);
    return res.status(500).json({ status: "error", message: "Could not load deleted workspaces.", error: error.message });
  }
};

exports.restoreWorkspace = async (req, res) => {
  try {
    const workspace = await getWorkspaceForPurge(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ status: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist. It may already have been permanently deleted." });
    if (!workspace.deleted_at) return res.status(409).json({ status: "error", code: "WORKSPACE_NOT_SOFT_DELETED", message: "Only soft-deleted workspaces can be restored." });
    const activeOwned = await countActiveOwnedWorkspaces(workspace.created_by);
    if (activeOwned >= MAX_OWNED_WORKSPACES) return res.status(409).json({ status: "error", code: "WORKSPACE_LIMIT_REACHED", message: "The workspace owner already has the maximum number of active workspaces." });
    const { data: restored, error } = await supabase.from("workspaces").update({ deleted_at: null }).eq("id", workspace.id).select("id, name, description, created_by, created_at, deleted_at").single();
    if (error) throw error;
    await createActivityLog({ actorUserId: req.user.id, adminId: req.user.id, actionType: "ADMIN_RESTORE_WORKSPACE", entityType: "workspaces", entityId: workspace.id, oldData: workspace, newData: restored, request: req, riskLevel: "INFO", details: `System Admin restored workspace \"${workspace.name}\".` });
    await notifyWorkspaceMembers({ workspaceId: workspace.id, actionType: "WORKSPACE_RESTORED", oldData: workspace, newData: { name: workspace.name, notificationType: "restored", restoredBy: req.user.id }, request: req, details: `Workspace \"${workspace.name}\" has been restored by the System Administrator.` });
    return res.status(200).json({ status: "success", message: "Workspace restored successfully.", data: restored });
  } catch (error) {
    console.error("Admin restore workspace error:", error);
    return res.status(500).json({ status: "error", message: "Could not restore workspace." });
  }
};

exports.getWorkspacePurgePreview = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const workspace = await getWorkspaceForPurge(workspaceId);
    if (!workspace) {
      return res.status(404).json({ status: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist. It may already have been permanently deleted." });
    }
    if (!workspace.deleted_at) {
      return res.status(409).json({ status: "error", code: "WORKSPACE_NOT_SOFT_DELETED", message: "Active workspaces cannot be permanently deleted. Soft-delete the workspace first." });
    }

    const documents = await getWorkspaceDocuments(workspaceId);
    const deletedDocuments = documents.filter((document) => !document.library_id);
    const preservedDocuments = documents.filter((document) => document.library_id);
    const deletedDocumentIds = deletedDocuments.map((document) => document.id);
    const documentFilter = (query) => deletedDocumentIds.length ? query.in("document_id", deletedDocumentIds) : query.eq("document_id", "00000000-0000-0000-0000-000000000000");
    const workspaceFilter = (query) => query.eq("workspace_id", workspaceId);
    const topicIdsResult = await supabase.from("workspace_discussion_topics").select("id").eq("workspace_id", workspaceId);
    if (topicIdsResult.error && !["42P01", "PGRST205"].includes(topicIdsResult.error.code)) throw topicIdsResult.error;
    const topicIds = (topicIdsResult.data || []).map((topic) => topic.id);
    const topicFilter = (query) => topicIds.length ? query.in("topic_id", topicIds) : query.eq("topic_id", "00000000-0000-0000-0000-000000000000");

    const [members, messages, folders, workspaceFlashcards, aiSummaries, documentChunks, documentTags, documentFlashcards, reviews, discussionComments, discussionSubtasks, discussionAttachments] = await Promise.all([
      countRows("workspace_members", workspaceFilter), countRows("workspace_messages", workspaceFilter), countRows("folders", workspaceFilter), countRows("flashcards", workspaceFilter),
      countRows("ai_summaries", documentFilter), countRows("document_chunks", documentFilter), countRows("document_tags", documentFilter), countRows("flashcards", documentFilter), countRows("reviews", documentFilter),
      countRows("workspace_discussion_comments", topicFilter), countRows("workspace_discussion_subtasks", topicFilter), countRows("workspace_discussion_attachments", topicFilter),
    ]);

    return res.status(200).json({
      status: "success",
      data: {
        workspace,
        deletion: { members, messages, folders, documents: deletedDocuments.length, aiSummaries, documentChunks, documentTags, flashcards: workspaceFlashcards + documentFlashcards, reviews, discussionTopics: topicIds.length, discussionComments, discussionSubtasks, discussionAttachments, reclaimableBytes: deletedDocuments.reduce((total, document) => total + Number(document.file_size_bytes || 0), 0) },
        preservation: { documents: preservedDocuments.length, documentList: preservedDocuments.map(({ id, title, library_id: libraryId, file_size_bytes: fileSizeBytes }) => ({ id, title, libraryId, fileSizeBytes })) },
      },
    });
  } catch (error) {
    console.error("Admin workspace purge preview error:", error);
    return res.status(500).json({ status: "error", message: "Could not load workspace purge preview.", error: error.message });
  }
};

exports.permanentlyDeleteWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const workspace = await getWorkspaceForPurge(workspaceId);
    if (!workspace) return res.status(404).json({ status: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist. It may already have been permanently deleted." });
    if (!workspace.deleted_at) return res.status(409).json({ status: "error", code: "WORKSPACE_NOT_SOFT_DELETED", message: "Active workspaces cannot be permanently deleted. Soft-delete the workspace first." });
    if (String(req.body.confirmation || "") !== workspace.name) return res.status(400).json({ status: "error", code: "INVALID_DELETE_CONFIRMATION", message: "Type the workspace name exactly to confirm permanent deletion." });

    const documents = await getWorkspaceDocuments(workspaceId);
    const workspaceOnlyDocuments = documents.filter((document) => !document.library_id);
    const bytesFreed = workspaceOnlyDocuments.reduce((total, document) => total + Number(document.file_size_bytes || 0), 0);

    // BR-ADM-06 requires workspace-only files to be removed before the
    // database purge. A storage failure must leave the database intact so the
    // operation can be retried safely.
    await removeWorkspaceStorageFiles(workspaceOnlyDocuments);

    const { data, error } = await supabase.rpc("admin_hard_delete_workspace", { p_workspace_id: workspaceId });
    if (error) {
      if (String(error.message).includes("WORKSPACE_NOT_FOUND")) return res.status(404).json({ status: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist. It may already have been permanently deleted." });
      if (String(error.message).includes("WORKSPACE_NOT_SOFT_DELETED")) return res.status(409).json({ status: "error", code: "WORKSPACE_NOT_SOFT_DELETED", message: "Active workspaces cannot be permanently deleted. Soft-delete the workspace first." });
      throw error;
    }

    await createActivityLog({ actorUserId: req.user.id, adminId: req.user.id, actionType: "ADMIN_PERMANENTLY_DELETE_WORKSPACE", entityType: "workspaces", entityId: workspaceId, oldData: workspace, newData: { ...data, bytesFreed }, request: req, riskLevel: "HIGH", details: `System Admin permanently deleted soft-deleted workspace "${workspace.name}".` });
    return res.status(200).json({ status: "success", message: "Workspace permanently deleted.", data: { ...data, bytesFreed } });
  } catch (error) {
    console.error("Admin permanent workspace deletion error:", error);
    return res.status(500).json({ status: "error", message: "Could not permanently delete workspace. Storage cleanup must succeed before the database is purged.", error: error.message });
  }
};
