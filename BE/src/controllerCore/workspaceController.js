const supabase = require("../config/supabase");
const crypto = require("crypto");
const path = require("path");
const { createMailTransporter } = require("../utils/mailerService");
const { createActivityLog } = require("../services/activityLogService");
const { MAX_OWNED_WORKSPACES, countActiveOwnedWorkspaces } = require("../services/workspaceLimitService");

const MEMBER_ROLES = ["Editor", "Viewer"];
const ASSIGNABLE_MEMBER_ROLES = ["Editor", "Viewer"];
const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "documents";
const WAITING_BUCKET =
  process.env.SUPABASE_DOCUMENT_WAITING_ADMIN_APPROVED ||
  "document_waiting_admin";

function normalizeUploadedFileName(fileName) {
  const value = String(fileName || "");
  if (!value || [...value].some((character) => character.charCodeAt(0) > 255)) {
    return value.normalize("NFC");
  }

  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD")
    ? value.normalize("NFC")
    : decoded.normalize("NFC");
}

function normalizeDiscussionTopicTitle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

async function findDuplicateDiscussionTopic(
  workspaceId,
  title,
  excludedTopicId = null,
) {
  let query = supabase
    .from("workspace_discussion_topics")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (excludedTopicId) query = query.neq("id", excludedTopicId);

  const { data, error } = await query;
  if (error) throw error;

  const normalizedTitle = normalizeDiscussionTopicTitle(title);
  return (data || []).find(
    (topic) => normalizeDiscussionTopicTitle(topic.title) === normalizedTitle,
  );
}

async function moveWorkspaceDocumentToBucket(document, targetBucket) {
  if (!document?.file_url) {
    return { moved: false, sourceBucket: null, targetBucket };
  }

  const candidateBuckets =
    targetBucket === DOCUMENT_BUCKET
      ? [WAITING_BUCKET, DOCUMENT_BUCKET]
      : [DOCUMENT_BUCKET, WAITING_BUCKET];

  let sourceBucket = null;
  let fileBlob = null;
  let lastDownloadError = null;

  for (const bucket of candidateBuckets) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(document.file_url);
    if (!error && data) {
      sourceBucket = bucket;
      fileBlob = data;
      break;
    }
    lastDownloadError = error;
  }

  if (!sourceBucket || !fileBlob) {
    throw lastDownloadError || new Error("Workspace document file is missing.");
  }
  if (sourceBucket === targetBucket) {
    return { moved: false, sourceBucket, targetBucket };
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(targetBucket)
    .upload(document.file_url, buffer, {
      contentType: "application/octet-stream",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { error: removeError } = await supabase.storage
    .from(sourceBucket)
    .remove([document.file_url]);
  if (removeError) {
    // Do not leave duplicate copies when the source removal fails.
    await supabase.storage.from(targetBucket).remove([document.file_url]);
    throw removeError;
  }

  return { moved: true, sourceBucket, targetBucket };
}

function getWorkspaceRoleLabel(role) {
  return String(role || "").toLowerCase() === "viewer" ? "Contributor" : role;
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return "Just now";
  const date = new Date(dateInput);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return "Just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const MESSAGE_SELECT = `
  id,
  workspace_id,
  sender_id,
  content,
  is_edited,
  created_at,
  sender:profiles!workspace_messages_sender_id_fkey (
    id,
    email,
    username,
    full_name,
    avatar_url
  )
`;
const FLASHCARD_SELECT = `
  id,
  document_id,
  workspace_id,
  creator_id,
  question,
  answer,
  created_at,
  document:documents!flashcards_document_id_fkey (
    id,
    title,
    status
  )
`;
const WORKSPACE_DOCUMENT_SELECT = `
  id,
  uploader_id,
  workspace_id,
  library_id,
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
`;
const DISCUSSION_TOPIC_SELECT = `
  id,
  workspace_id,
  created_by,
  title,
  content,
  topic_type,
  status,
  priority,
  date_mode,
  start_date,
  end_date,
  is_pinned,
  created_at,
  updated_at,
  creator:profiles!workspace_discussion_topics_created_by_fkey (
    id,
    email,
    username,
    full_name,
    avatar_url
  ),
  comments:workspace_discussion_comments (
    id,
    topic_id,
    user_id,
    content,
    is_edited,
    created_at,
    updated_at,
    author:profiles!workspace_discussion_comments_user_id_fkey (
      id,
      email,
      username,
      full_name,
      avatar_url
    )
  ),
  subtasks:workspace_discussion_subtasks (
    id,
    topic_id,
    created_by,
    title,
    is_done,
    sort_order,
    created_at,
    updated_at,
    creator:profiles!workspace_discussion_subtasks_created_by_fkey (
      id,
      email,
      username,
      full_name,
      avatar_url
    )
  ),
  attachments:workspace_discussion_attachments (
    id,
    topic_id,
    uploaded_by,
    file_name,
    file_url,
    file_size_bytes,
    mime_type,
    created_at,
    uploader:profiles!workspace_discussion_attachments_uploaded_by_fkey (
      id,
      email,
      username,
      full_name,
      avatar_url
    )
  )
`;

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
}

async function notifyWorkspaceMembers({
  workspaceId,
  actionType,
  oldData,
  newData,
  details,
  request,
}) {
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId);

  if (error) throw error;

  const results = await Promise.allSettled(
    (members || []).map((member) =>
      createActivityLog({
        actorUserId: member.user_id,
        actionType,
        entityType: "workspace",
        entityId: workspaceId,
        oldData,
        newData,
        request,
        details,
      }),
    ),
  );

  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Workspace notification log failed:", result.reason);
    }
  });
}

exports.notifyWorkspaceMembers = notifyWorkspaceMembers;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendWorkspaceInviteEmail({ to, workspace, inviter, role, inviteUrl }) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("Email service is not configured.");
  }

  const workspaceUrl = inviteUrl || `${getFrontendUrl()}/dashboard/workspaces/${workspace.id}`;
  const inviterName =
    inviter?.full_name || inviter?.username || inviter?.email || "A workspace admin";
  const workspaceName = workspace?.name || "AI StudyHub workspace";
  const safeInviterName = escapeHtml(inviterName);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeRole = escapeHtml(role);
  const safeWorkspaceUrl = escapeHtml(workspaceUrl);

  const transporter = createMailTransporter();

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `AI StudyHub - Workspace invitation: ${workspaceName}`,
    text: [
      `Hi,`,
      ``,
      `${inviterName} invited you to join the workspace "${workspaceName}" on AI StudyHub as ${role}.`,
      `Open workspace: ${workspaceUrl}`,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #172033; line-height: 1.55;">
        <h2 style="margin: 0 0 12px;">You have been invited to a workspace</h2>
        <p><strong>${safeInviterName}</strong> invited you to join <strong>${safeWorkspaceName}</strong> on AI StudyHub as <strong>${safeRole}</strong>.</p>
        <p>
          <a href="${safeWorkspaceUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none;">
            Open workspace
          </a>
        </p>
        <p style="color: #64748b; font-size: 13px;">If you were not expecting this invitation, you can ignore this email.</p>
      </div>
    `,
  });
}

async function getWorkspaceAccess(workspaceId, userId) {
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at")
    .eq("id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (workspaceError) throw workspaceError;
  if (!workspace) return { workspace: null, member: null, isAdmin: false };

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, role, joined_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) throw memberError;

  const isCreator = String(workspace.created_by) === String(userId);
  const isAdmin = isCreator || member?.role === "Admin";

  return { workspace, member, isAdmin };
}

async function countWorkspaceAdmins(workspaceId) {
  const { count, error } = await supabase
    .from("workspace_members")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "Admin");

  if (error) throw error;

  return count || 0;
}

async function getWorkspaceDiscussionAccess(workspaceId, userId) {
  const access = await getWorkspaceAccess(workspaceId, userId);
  if (!access.workspace || !access.member) {
    return {
      ...access,
      canReadDiscussion: false,
      canWriteDiscussion: false,
      canSubmitSolutions: false,
    };
  }

  const canWriteDiscussion =
    access.isAdmin || ["Admin", "Editor"].includes(access.member?.role);

  return {
    ...access,
    canReadDiscussion: true,
    canWriteDiscussion,
    canSubmitSolutions: true,
  };
}

async function getDiscussionTopicInWorkspace(workspaceId, topicId) {
  const { data, error } = await supabase
    .from("workspace_discussion_topics")
    .select("id, created_by")
    .eq("workspace_id", workspaceId)
    .eq("id", topicId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function mapWorkspaceMessage(row) {
  const sender = row.sender || {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    senderId: row.sender_id,
    senderName:
      sender.full_name || sender.username || sender.email || "Workspace member",
    senderEmail: sender.email || "",
    senderAvatar: sender.avatar_url || "",
    text: row.content,
    isEdited: row.is_edited === true,
    createdAt: row.created_at,
  };
}

function mapWorkspaceFlashcard(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    workspaceId: row.workspace_id,
    creatorId: row.creator_id,
    question: row.question,
    answer: row.answer,
    createdAt: row.created_at,
    documentTitle: row.document?.title || "Workspace flashcards",
    documentStatus: row.document?.status || "",
  };
}

function mapWorkspaceDocument(row) {
  const uploader = row.uploader || {};

  return {
    id: row.id,
    uploaderId: row.uploader_id,
    workspaceId: row.workspace_id,
    libraryId: row.library_id,
    title: row.title,
    fileSizeBytes: row.file_size_bytes,
    file_size_bytes: row.file_size_bytes,
    isPublic: row.is_public === true,
    status: row.status,
    aiRejectReason: row.ai_reject_reason,
    reviewedByAdminId: row.reviewed_by_admin_id,
    reviewedAt: row.reviewed_at,
    adminReviewReason: row.admin_review_reason,
    createdAt: row.created_at,
    created_at: row.created_at,
    uploaderName:
      uploader.full_name || uploader.username || uploader.email || "Unknown user",
    uploaderEmail: uploader.email || "",
  };
}

function mapDiscussionUser(user, fallback = "Workspace member") {
  return {
    id: user?.id || null,
    email: user?.email || "",
    username: user?.username || "",
    fullName: user?.full_name || "",
    avatarUrl: user?.avatar_url || "",
    name: user?.full_name || user?.username || user?.email || fallback,
  };
}

function mapDiscussionComment(row) {
  const solutionPrefix = "[[SOLUTION]]";
  const solutionReplyMatch = String(row.content || "").match(
    /^\[\[SOLUTION_REPLY:([^\]]+)\]\]/,
  );
  const isSolution = String(row.content || "").startsWith(solutionPrefix);
  const isSolutionReply = Boolean(solutionReplyMatch);
  const storedPrefix = solutionReplyMatch?.[0] || "";

  return {
    id: row.id,
    topicId: row.topic_id,
    userId: row.user_id,
    content: isSolution
      ? row.content.slice(solutionPrefix.length)
      : isSolutionReply
        ? row.content.slice(storedPrefix.length)
        : row.content,
    kind: isSolution ? "solution" : isSolutionReply ? "solutionReply" : "comment",
    solutionId: solutionReplyMatch?.[1] || null,
    isEdited: row.is_edited === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: mapDiscussionUser(row.author),
  };
}

function mapDiscussionSubtask(row) {
  return {
    id: row.id,
    topicId: row.topic_id,
    createdBy: row.created_by,
    title: row.title,
    isDone: row.is_done === true,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator: mapDiscussionUser(row.creator),
  };
}

function mapDiscussionAttachment(row) {
  const storedMimeType = row.mime_type || "";
  const isSolution = storedMimeType.startsWith("solution:");
  const solutionMetadata = isSolution
    ? storedMimeType.slice("solution:".length)
    : "";
  const solutionSeparatorIndex = solutionMetadata.indexOf("|");
  const solutionId = solutionSeparatorIndex >= 0
    ? solutionMetadata.slice(0, solutionSeparatorIndex) || null
    : null;
  const cleanMimeType = solutionSeparatorIndex >= 0
    ? solutionMetadata.slice(solutionSeparatorIndex + 1)
    : solutionMetadata;

  return {
    id: row.id,
    topicId: row.topic_id,
    uploadedBy: row.uploaded_by,
    fileName: normalizeUploadedFileName(row.file_name),
    fileUrl: row.file_url,
    fileSizeBytes: row.file_size_bytes || 0,
    mimeType: isSolution ? cleanMimeType : storedMimeType,
    kind: isSolution ? "solution" : "attachment",
    solutionId,
    createdAt: row.created_at,
    uploader: mapDiscussionUser(row.uploader),
  };
}

function mapDiscussionTopic(row) {
  const creator = row.creator || {};
  const mappedComments = (row.comments || []).map(mapDiscussionComment);

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    creator: creator.full_name || creator.username || creator.email || "Workspace member",
    creatorDetails: mapDiscussionUser(creator),
    title: row.title,
    content: row.content || "",
    type: row.topic_type,
    status: row.status,
    priority: row.priority,
    dateMode: row.date_mode,
    startDate: row.start_date,
    endDate: row.end_date,
    isPinned: row.is_pinned === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: mappedComments
      .filter((comment) => comment.kind === "comment"),
    solutions: mappedComments
      .filter((comment) => comment.kind === "solution")
      .map((solution) => ({
        ...solution,
        replies: mappedComments.filter(
          (comment) =>
            comment.kind === "solutionReply" &&
            String(comment.solutionId) === String(solution.id),
        ),
      })),
    subtasks: (row.subtasks || []).map(mapDiscussionSubtask),
    files: (row.attachments || []).map(mapDiscussionAttachment),
  };
}

exports.createWorkspace = async (req, res) => {
  try {
    const userId = req.user.id;
    const name = req.body.name?.trim();
    const description = req.body.description?.trim() || null;

    if (!name) {
      return res
        .status(400)
        .json({ status: "error", message: "Workspace name is required." });
    }

    if (userId === "guest" || userId === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest users cannot create workspaces.",
      });
    }

    const ownedWorkspaceCount = await countActiveOwnedWorkspaces(userId);

    if ((ownedWorkspaceCount || 0) >= MAX_OWNED_WORKSPACES) {
      return res.status(409).json({
        status: "error",
        code: "WORKSPACE_LIMIT_REACHED",
        message: `You can create up to ${MAX_OWNED_WORKSPACES} workspaces. Delete an existing workspace before creating another one.`,
      });
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({ name, description, created_by: userId })
      .select("id, name, description, created_by, created_at")
      .single();

    if (workspaceError) throw workspaceError;

    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: userId, role: "Admin" });

    if (memberError) {
      await supabase.from("workspaces").delete().eq("id", workspace.id);
      throw memberError;
    }

    return res.status(201).json({ status: "success", data: workspace });
  } catch (error) {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Could not create workspace.",
        error: error.message,
      });
  }
};

exports.listMyWorkspaces = async (req, res) => {
  try {
    if (req.user.id === "guest") {
      return res.status(200).json({
        status: "success",
        data: [],
      });
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .select(
        `
        role,
        joined_at,
        workspace:workspaces!workspace_members_workspace_id_fkey!inner (
          id,
          name,
          description,
          created_by,
          created_at,
          deleted_at
        )
      `,
      )
      .eq("user_id", req.user.id)
      .is("workspace.deleted_at", null)
      .order("joined_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: (data || [])
        .filter((row) => row.workspace?.id)
        .map((row) => ({
          ...row.workspace,
          myRole: row.role,
          joinedAt: row.joined_at,
        })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Could not load workspaces.",
        error: error.message,
      });
  }
};

exports.getWorkspace = async (req, res) => {
  try {
    const { workspace, member, isAdmin } = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );

    if (!workspace || (!member && !isAdmin)) {
      return res
        .status(404)
        .json({ status: "error", message: "Workspace not found." });
    }

    return res.status(200).json({
      status: "success",
      data: { ...workspace, myRole: member?.role || "Admin" },
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Could not load workspace.",
        error: error.message,
      });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const { workspace, member, isAdmin } = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );

    if (!workspace || (!member && !isAdmin)) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace.",
      });
    }

    const { data, error } = await supabase
      .from("workspace_messages")
      .select(MESSAGE_SELECT)
      .eq("workspace_id", req.params.workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: (data || []).map(mapWorkspaceMessage),
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not load workspace messages.",
      error: error.message,
    });
  }
};

exports.createMessage = async (req, res) => {
  try {
    const { workspace, member, isAdmin } = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );

    if (!workspace || (!member && !isAdmin)) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace.",
      });
    }

    const content = String(req.body.content || "").trim();
    if (!content) {
      return res.status(400).json({
        status: "error",
        message: "Message content is required.",
      });
    }

    const { data: insertedMessage, error: insertError } = await supabase
      .from("workspace_messages")
      .insert({
        workspace_id: req.params.workspaceId,
        sender_id: req.user.id,
        content,
      })
      .select(MESSAGE_SELECT)
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      status: "success",
      data: mapWorkspaceMessage(insertedMessage),
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not send workspace message.",
      error: error.message,
    });
  }
};

exports.listMembers = async (req, res) => {
  try {
    const { workspace, member } = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );

    if (!workspace || !member) {
      return res
        .status(403)
        .json({
          status: "error",
          message: "You cannot access this workspace.",
        });
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .select(
        `
        role,
        joined_at,
        user:profiles!workspace_members_user_id_fkey (
          id,
          email,
          username,
          full_name,
          status
        )
      `,
      )
      .eq("workspace_id", req.params.workspaceId)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: data || [],
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Could not load members.",
        error: error.message,
      });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const q = String(req.query.q || "")
      .trim()
      .replace(/^@+/, "")
      .replace(/[,%]/g, "")
      .trim();

    if (q.length < 2) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Search text must be at least 2 characters.",
        });
    }

    const access = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );
    if (!access.workspace || !access.isAdmin) {
      return res
        .status(403)
        .json({
          status: "error",
          message: "Only workspace admins can add members.",
        });
    }

    const { data: existingMembers, error: memberError } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", req.params.workspaceId);

    if (memberError) throw memberError;

    const existingIds = new Set(
      (existingMembers || []).map((m) => String(m.user_id)),
    );

    const { data: users, error: userError } = await supabase
      .from("profiles")
      .select("id, username, full_name, email, status")
      .select("id, username, full_name, email, status")
      .neq("status", "DISABLED")
      .or(
        `username.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%`,
      )
      .limit(20);

    if (userError) throw userError;

    return res.status(200).json({
      status: "success",
      data: (users || []).map((user) => ({
        ...user,
        isWorkspaceMember: existingIds.has(String(user.id)),
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Could not search users.",
        error: error.message,
      });
  }
};

exports.addMember = async (req, res) => {
  try {
    const { userId, role = "Viewer" } = req.body;

    if (!userId || !MEMBER_ROLES.includes(role)) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Valid userId and role are required.",
        });
    }

    const { data: invitedUser, error: invitedUserError } = await supabase
      .from("profiles")
      .select("id, email, username, full_name, status")
      .eq("id", userId)
      .maybeSingle();

    if (invitedUserError) throw invitedUserError;

    if (!invitedUser || invitedUser.status === "DISABLED") {
      return res
        .status(404)
        .json({
          status: "error",
          message: "The invited user was not found or is disabled.",
        });
    }

    const access = await getWorkspaceAccess(
      req.params.workspaceId,
      req.user.id,
    );
    if (!access.workspace || !access.isAdmin) {
      return res
        .status(403)
        .json({
          status: "error",
          message: "Only workspace admins can add members.",
        });
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", req.params.workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMember) {
      return res.status(409).json({
        status: "error",
        message: "This user is already a member of the workspace.",
      });
    }

    const { data: inviter } = await supabase
      .from("profiles")
      .select("id, email, username, full_name")
      .eq("id", req.user.id)
      .maybeSingle();

    const inviterName = inviter?.full_name || inviter?.username || inviter?.email || "Workspace Admin";
    const workspaceName = access.workspace.name || "Workspace";
    const workspaceDescription = access.workspace.description || "";

    // Create in-app invitation notification log
    const { data: logData, error: logError } = await supabase
      .from("activity_logs")
      .insert({
        user_id: userId,
        admin_id: req.user.id,
        action_type: "WORKSPACE_INVITATION_PENDING",
        entity_type: "workspace",
        entity_id: req.params.workspaceId,
        old_data: { status: "PENDING", role },
        new_data: {
          workspaceId: req.params.workspaceId,
          workspaceName,
          workspaceDescription,
          inviterId: req.user.id,
          inviterName,
          role,
          status: "PENDING",
          notificationType: "workspaceInvitation",
        },
        details: `${inviterName} invited you to join workspace "${workspaceName}" as ${role === "Viewer" ? "Contributor" : role}.`,
      })
      .select("id, created_at")
      .single();

    if (logError) throw logError;

    return res.status(201).json({
      status: "success",
      message: "Thư mời tham gia nhóm đã được gửi tới người dùng.",
      data: {
        invitationId: logData.id,
        workspaceId: req.params.workspaceId,
        invitedUser: {
          id: invitedUser.id,
          email: invitedUser.email,
          username: invitedUser.username,
          full_name: invitedUser.full_name,
        },
        role,
        status: "PENDING",
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not send workspace invitation.",
      error: error.message,
    });
  }
};

exports.updateMemberRole = async (req, res) => {
  try {
    const { workspaceId, userId } = req.params;
    const { role } = req.body;

    if (!ASSIGNABLE_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({
        status: "error",
        message: "Role must be Editor or Contributor.",
      });
    }

    const access = await getWorkspaceAccess(workspaceId, req.user.id);
    if (!access.workspace || !access.isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace admins can update member roles.",
      });
    }

    const { data: currentMember, error: currentMemberError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (currentMemberError) throw currentMemberError;

    if (!currentMember) {
      return res.status(404).json({
        status: "error",
        message: "Workspace member not found.",
      });
    }

    if (
      currentMember.role === "Admin" &&
      role !== "Admin" &&
      (await countWorkspaceAdmins(workspaceId)) <= 1
    ) {
      return res.status(400).json({
        status: "error",
        message: "A workspace must have at least one admin.",
      });
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .update({ role })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .select(
        `
        role,
        joined_at,
        user:profiles!workspace_members_user_id_fkey (
          id,
          email,
          username,
          full_name,
          status
        )
      `,
      )
      .single();

    if (error) throw error;

    if (currentMember.role !== role) {
      await createActivityLog({
        actorUserId: userId,
        actionType: "WORKSPACE_ROLE_CHANGED",
        entityType: "workspace",
        entityId: workspaceId,
        oldData: { role: currentMember.role },
        newData: {
          role,
          workspaceName: access.workspace.name,
          changedBy: req.user.id,
        },
        request: req,
        details: `Your role in ${access.workspace.name || "a workspace"} changed from ${getWorkspaceRoleLabel(currentMember.role)} to ${getWorkspaceRoleLabel(role)}.`,
      });
    }

    return res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("updateMemberRole error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update member role.",
      error: error.message,
    });
  }
};

exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const readTimestamp = new Date().toISOString();

    try {
      await supabase
        .from("profiles")
        .update({ notifications_read_at: readTimestamp })
        .eq("id", userId);
    } catch (profileErr) {
      console.warn("Could not update notifications_read_at on profile:", profileErr);
    }

    const { data: logs } = await supabase
      .from("activity_logs")
      .select("id, new_data")
      .eq("user_id", userId);

    if (logs && logs.length > 0) {
      for (const logItem of logs) {
        if (!logItem.new_data?.is_read) {
          await supabase
            .from("activity_logs")
            .update({
              new_data: {
                ...(logItem.new_data || {}),
                is_read: true,
              },
            })
            .eq("id", logItem.id);
        }
      }
    }

    return res.status(200).json({
      status: "success",
      message: "All notifications marked as read.",
    });
  } catch (error) {
    console.error("markAllNotificationsAsRead error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not mark notifications as read.",
      error: error.message,
    });
  }
};

exports.listMyWorkspaceNotifications = async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("notifications_read_at")
      .eq("id", req.user.id)
      .maybeSingle();

    const lastReadAtMs = profile?.notifications_read_at
      ? new Date(profile.notifications_read_at).getTime()
      : 0;

    const { data, error } = await supabase
      .from("activity_logs")
      .select("id, entity_id, old_data, new_data, details, created_at")
      .eq("user_id", req.user.id)
      .in("action_type", [
        "WORKSPACE_ROLE_CHANGED",
        "WORKSPACE_RENAMED",
        "WORKSPACE_DELETED",
        "DOCUMENT_APPROVED",
        "DOCUMENT_REJECTED",
        "WORKSPACE_INVITATION_PENDING",
        "WORKSPACE_MEMBER_LEFT",
      ])
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: (data || []).map((item) => {
        const createdAtMs = new Date(item.created_at).getTime();
        const isRead = Boolean(
          item.new_data?.is_read || (lastReadAtMs > 0 && createdAtMs <= lastReadAtMs)
        );
        const actionType = item.new_data?.notificationType || "roleChanged";
        if (actionType === "workspaceInvitation") {
          const invStatus = item.new_data?.status || item.old_data?.status || "PENDING";
          return {
            id: `invitation-${item.id}`,
            logId: item.id,
            category: "invitation",
            action: "workspaceInvitation",
            title: "Workspace invitation",
            message: item.details,
            workspaceId: item.entity_id,
            workspaceName: item.new_data?.workspaceName || "Workspace",
            workspaceDescription: item.new_data?.workspaceDescription || "No description provided.",
            inviterName: item.new_data?.inviterName || "Workspace Admin",
            role: item.new_data?.role || "Contributor",
            status: invStatus,
            isInvitation: true,
            isRead,
            icon: "ti-email",
            link: `/dashboard/workspaces/${item.entity_id}`,
            createdAt: formatRelativeTime(item.created_at),
            createdAtMs,
          };
        }

        if (actionType === "memberLeft") {
          return {
            id: `member-left-${item.id}`,
            category: "member",
            action: "memberLeft",
            title: "Member left workspace",
            message: item.details,
            isRead,
            icon: "ti-user",
            link: `/dashboard/workspaces/${item.entity_id}`,
            createdAt: formatRelativeTime(item.created_at),
            createdAtMs,
          };
        }

        const isDocumentModeration =
          actionType === "moderationApproved" ||
          actionType === "moderationRejected";
        const isDeleted = actionType === "deleted";
        const documentTitle = item.new_data?.documentTitle || "Your document";
        const libraryLink = item.new_data?.libraryId
          ? `/dashboard/libraries/${item.new_data.libraryId}`
          : "/dashboard/libraries";
        return {
          id: `workspace-event-${item.id}`,
          category: isDocumentModeration
            ? "file"
            : actionType === "roleChanged"
              ? "member"
              : "workspace",
          action: actionType,
          title:
            actionType === "moderationApproved"
              ? "Document approved"
              : actionType === "moderationRejected"
                ? "Document rejected"
                : actionType === "renamed"
              ? "Workspace renamed"
              : isDeleted
                ? "Workspace deleted"
                : "Workspace role changed",
          message: (
            item.details ||
            (isDocumentModeration
              ? `${documentTitle} has been reviewed by admin.`
              : `Your workspace role changed from ${getWorkspaceRoleLabel(item.old_data?.role || "member")} to ${getWorkspaceRoleLabel(item.new_data?.role || "a new role")}.`)
          ).replace(/\bViewer\b/gi, "Contributor"),
          isRead,
          icon: isDocumentModeration
            ? actionType === "moderationApproved"
              ? "ti-check"
              : "ti-trash"
            : isDeleted
              ? "ti-trash"
              : actionType === "renamed"
                ? "ti-pencil"
                : "ti-user",
          link: isDocumentModeration
            ? libraryLink
            : isDeleted
              ? "/dashboard/workspaces"
              : `/dashboard/workspaces/${item.entity_id}`,
          createdAt: formatRelativeTime(item.created_at),
          createdAtMs,
        };
      }),
    });
  } catch (error) {
    console.error("listMyWorkspaceNotifications error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load workspace notifications.",
    });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const { workspaceId, userId } = req.params;

    const access = await getWorkspaceAccess(workspaceId, req.user.id);
    if (!access.workspace || !access.isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace admins can remove members.",
      });
    }

    if (String(access.workspace.created_by) === String(userId)) {
      return res.status(400).json({
        status: "error",
        message: "The workspace creator cannot be removed.",
      });
    }

    const { data: currentMember, error: currentMemberError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (currentMemberError) throw currentMemberError;

    if (!currentMember) {
      return res.status(404).json({
        status: "error",
        message: "Workspace member not found.",
      });
    }

    if (
      currentMember.role === "Admin" &&
      (await countWorkspaceAdmins(workspaceId)) <= 1
    ) {
      return res.status(400).json({
        status: "error",
        message: "A workspace must have at least one admin.",
      });
    }

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      message: "Member removed from workspace.",
    });
  } catch (error) {
    console.error("removeMember error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not remove member.",
      error: error.message,
    });
  }
};

exports.listFlashcards = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    const { workspace, member, isAdmin } = await getWorkspaceAccess(
      workspaceId,
      userId,
    );

    if (!workspace) {
      return res
        .status(404)
        .json({ status: "error", message: "Workspace not found." });
    }

    if (!member && !isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "You do not have access to this workspace.",
      });
    }

    const { data, error } = await supabase
      .from("flashcards")
      .select(FLASHCARD_SELECT)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: (data || []).map(mapWorkspaceFlashcard),
    });
  } catch (error) {
    console.error("listFlashcards error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load workspace flashcards.",
    });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    const { workspace, member, isAdmin } = await getWorkspaceAccess(
      workspaceId,
      userId,
    );

    if (!workspace || (!member && !isAdmin)) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace.",
      });
    }

    const { data, error } = await supabase
      .from("documents")
      .select(WORKSPACE_DOCUMENT_SELECT)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const { data: topicRows, error: topicRowsError } = await supabase
      .from("workspace_discussion_topics")
      .select("id")
      .eq("workspace_id", workspaceId);
    if (topicRowsError) throw topicRowsError;

    const topicIds = (topicRows || []).map((topic) => topic.id);
    let attachmentPaths = new Set();
    if (topicIds.length > 0) {
      const { data: attachmentRows, error: attachmentRowsError } = await supabase
        .from("workspace_discussion_attachments")
        .select("file_url")
        .in("topic_id", topicIds);
      if (attachmentRowsError) throw attachmentRowsError;
      attachmentPaths = new Set(
        (attachmentRows || []).map((attachment) => attachment.file_url),
      );
    }

    return res.status(200).json({
      status: "success",
      data: (data || [])
        .filter((document) => !attachmentPaths.has(document.file_url))
        .map(mapWorkspaceDocument),
    });
  } catch (error) {
    console.error("listWorkspaceDocuments error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load workspace documents.",
      error: error.message,
    });
  }
};

exports.reviewDocument = async (req, res) => {
  try {
    const { workspaceId, documentId } = req.params;
    const { decision, reason } = req.body;
    const userId = req.user.id;

    if (!["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({
        status: "error",
        message: "decision must be APPROVE or REJECT.",
      });
    }

    const { workspace, isAdmin } = await getWorkspaceAccess(workspaceId, userId);

    if (!workspace) {
      return res
        .status(404)
        .json({ status: "error", message: "Workspace not found." });
    }

    if (!isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace admins can review workspace documents.",
      });
    }

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle();

    if (documentError) throw documentError;

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Workspace document not found.",
      });
    }

    const newStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const storageMove = await moveWorkspaceDocumentToBucket(
      document,
      decision === "APPROVE" ? DOCUMENT_BUCKET : WAITING_BUCKET,
    );

    const { data: updatedDocument, error: updateError } = await supabase
      .from("documents")
      .update({
        status: newStatus,
        reviewed_by_admin_id: userId,
        reviewed_at: new Date().toISOString(),
        admin_review_reason:
          String(reason || "").trim() ||
          `${newStatus.toLowerCase()} by workspace admin.`,
      })
      .eq("id", documentId)
      .eq("workspace_id", workspaceId)
      .select(WORKSPACE_DOCUMENT_SELECT)
      .single();

    if (updateError) {
      if (storageMove.moved && storageMove.sourceBucket) {
        try {
          await moveWorkspaceDocumentToBucket(
            document,
            storageMove.sourceBucket,
          );
        } catch (rollbackError) {
          console.error(
            "Could not roll back workspace document storage move:",
            rollbackError,
          );
        }
      }
      throw updateError;
    }

    return res.status(200).json({
      status: "success",
      data: mapWorkspaceDocument(updatedDocument),
    });
  } catch (error) {
    console.error("reviewWorkspaceDocument error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not review workspace document.",
      error: error.message,
    });
  }
};

exports.listDiscussionTopics = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canReadDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace discussion.",
      });
    }

    const { data, error } = await supabase
      .from("workspace_discussion_topics")
      .select(DISCUSSION_TOPIC_SELECT)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      data: (data || []).map(mapDiscussionTopic),
    });
  } catch (error) {
    console.error("listDiscussionTopics error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load discussion topics.",
      error: error.message,
    });
  }
};

exports.createDiscussionTopic = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can create discussion topics.",
      });
    }

    const title = String(req.body.title || "").trim().replace(/\s+/g, " ");
    if (!title) {
      return res.status(400).json({
        status: "error",
        message: "Topic title is required.",
      });
    }

    const duplicateTopic = await findDuplicateDiscussionTopic(
      workspaceId,
      title,
    );
    if (duplicateTopic) {
      return res.status(409).json({
        status: "error",
        code: "DUPLICATE_TOPIC_TITLE",
        message: "A topic with this title already exists in the workspace.",
      });
    }

    const payload = {
      workspace_id: workspaceId,
      created_by: req.user.id,
      title,
      content: String(req.body.content || "").trim() || null,
      topic_type: req.body.topicType || "Question",
      status: req.body.status || "In progress",
      priority: req.body.priority || "Normal",
      date_mode: req.body.dateMode || "none",
      start_date: req.body.startDate || null,
      end_date: req.body.endDate || null,
      is_pinned: req.body.isPinned === true,
    };

    const { data, error } = await supabase
      .from("workspace_discussion_topics")
      .insert(payload)
      .select(DISCUSSION_TOPIC_SELECT)
      .single();

    if (error) throw error;

    return res.status(201).json({
      status: "success",
      data: mapDiscussionTopic(data),
    });
  } catch (error) {
    console.error("createDiscussionTopic error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not create discussion topic.",
      error: error.message,
    });
  }
};

exports.updateDiscussionTopic = async (req, res) => {
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can update discussion topics.",
      });
    }

    const existingTopic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!existingTopic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const updatePayload = {};
    const fields = {
      title: "title",
      content: "content",
      topicType: "topic_type",
      status: "status",
      priority: "priority",
      dateMode: "date_mode",
      startDate: "start_date",
      endDate: "end_date",
      isPinned: "is_pinned",
    };

    Object.entries(fields).forEach(([bodyKey, column]) => {
      if (req.body[bodyKey] !== undefined) {
        updatePayload[column] = req.body[bodyKey];
      }
    });

    if (typeof updatePayload.title === "string") {
      updatePayload.title = updatePayload.title.trim().replace(/\s+/g, " ");
      if (!updatePayload.title) {
        return res.status(400).json({
          status: "error",
          message: "Topic title is required.",
        });
      }

      const duplicateTopic = await findDuplicateDiscussionTopic(
        workspaceId,
        updatePayload.title,
        topicId,
      );
      if (duplicateTopic) {
        return res.status(409).json({
          status: "error",
          code: "DUPLICATE_TOPIC_TITLE",
          message: "A topic with this title already exists in the workspace.",
        });
      }
    }

    if (typeof updatePayload.content === "string") {
      updatePayload.content = updatePayload.content.trim();
    }

    updatePayload.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("workspace_discussion_topics")
      .update(updatePayload)
      .eq("workspace_id", workspaceId)
      .eq("id", topicId)
      .is("deleted_at", null)
      .select(DISCUSSION_TOPIC_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: mapDiscussionTopic(data),
    });
  } catch (error) {
    console.error("updateDiscussionTopic error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update discussion topic.",
      error: error.message,
    });
  }
};

exports.deleteDiscussionTopic = async (req, res) => {
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can delete discussion topics.",
      });
    }

    const existingTopic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!existingTopic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const { error } = await supabase
      .from("workspace_discussion_topics")
      .update({ deleted_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", topicId);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      message: "Discussion topic deleted.",
    });
  } catch (error) {
    console.error("deleteDiscussionTopic error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not delete discussion topic.",
      error: error.message,
    });
  }
};

exports.addDiscussionComment = async (req, res) => {
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);
    const isSolution = req.body.kind === "solution";
    const isSolutionReply = req.body.kind === "solutionReply";

    if (
      !access.workspace ||
      (isSolution || isSolutionReply
        ? !access.canSubmitSolutions
        : !access.canReadDiscussion)
    ) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace discussion.",
      });
    }

    const rawContent = String(req.body.content || "").trim();
    const solutionId = String(req.body.solutionId || "").trim();
    if (isSolutionReply) {
      const { data: targetSolution, error: solutionError } = await supabase
        .from("workspace_discussion_comments")
        .select("id, content")
        .eq("id", solutionId)
        .eq("topic_id", topicId)
        .maybeSingle();
      if (solutionError) throw solutionError;
      if (
        !targetSolution ||
        !String(targetSolution.content || "").startsWith("[[SOLUTION]]")
      ) {
        return res.status(404).json({
          status: "error",
          message: "Solution not found.",
        });
      }
    }
    const content = isSolution
      ? `[[SOLUTION]]${rawContent}`
      : isSolutionReply
        ? `[[SOLUTION_REPLY:${solutionId}]]${rawContent}`
        : rawContent;
    if (!rawContent) {
      return res.status(400).json({
        status: "error",
        message: isSolution
          ? "Solution content is required."
          : isSolutionReply
            ? "Comment content is required."
          : "Comment content is required.",
      });
    }

    const { data: topic, error: topicError } = await supabase
      .from("workspace_discussion_topics")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", topicId)
      .is("deleted_at", null)
      .maybeSingle();

    if (topicError) throw topicError;
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    if (isSolution) {
      const { data: existingSolution, error: existingSolutionError } =
        await supabase
          .from("workspace_discussion_comments")
          .select("id")
          .eq("topic_id", topicId)
          .eq("user_id", req.user.id)
          .like("content", "[[SOLUTION]]%")
          .limit(1)
          .maybeSingle();

      if (existingSolutionError) throw existingSolutionError;
      if (existingSolution) {
        return res.status(409).json({
          status: "error",
          code: "SOLUTION_LIMIT_REACHED",
          message:
            "You have already submitted a solution for this topic. Edit your existing solution instead.",
        });
      }
    }

    const { data, error } = await supabase
      .from("workspace_discussion_comments")
      .insert({
        topic_id: topicId,
        user_id: req.user.id,
        content,
      })
      .select(
        `
        id,
        topic_id,
        user_id,
        content,
        is_edited,
        created_at,
        updated_at,
        author:profiles!workspace_discussion_comments_user_id_fkey (
          id,
          email,
          username,
          full_name,
          avatar_url
        )
      `,
      )
      .single();

    if (error) throw error;

    return res.status(201).json({
      status: "success",
      data: mapDiscussionComment(data),
    });
  } catch (error) {
    console.error("addDiscussionComment error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not add comment.",
      error: error.message,
    });
  }
};

exports.updateDiscussionComment = async (req, res) => {
  try {
    const { workspaceId, topicId, commentId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);
    if (!access.workspace || !access.canSubmitSolutions) {
      return res.status(403).json({ status: "error", message: "You cannot access this workspace discussion." });
    }

    const content = String(req.body.content || "").trim();
    if (!content) {
      return res.status(400).json({ status: "error", message: "Solution content is required." });
    }

    const { data: existing, error: findError } = await supabase
      .from("workspace_discussion_comments")
      .select("id, user_id, content")
      .eq("id", commentId)
      .eq("topic_id", topicId)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ status: "error", message: "Solution not found." });
    if (existing.user_id !== req.user.id || !String(existing.content || "").startsWith("[[SOLUTION]]")) {
      return res.status(403).json({ status: "error", message: "You can only edit your own solution." });
    }

    const { data, error } = await supabase
      .from("workspace_discussion_comments")
      .update({
        content: `[[SOLUTION]]${content}`,
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", commentId)
      .eq("topic_id", topicId)
      .select(`id, topic_id, user_id, content, is_edited, created_at, updated_at,
        author:profiles!workspace_discussion_comments_user_id_fkey (id, email, username, full_name, avatar_url)`)
      .single();
    if (error) throw error;
    return res.status(200).json({ status: "success", data: mapDiscussionComment(data) });
  } catch (error) {
    console.error("updateDiscussionComment error:", error);
    return res.status(500).json({ status: "error", message: "Could not update solution.", error: error.message });
  }
};

exports.addDiscussionSubtask = async (req, res) => {
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can add subtasks.",
      });
    }

    const topic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const title = String(req.body.title || "").trim();
    if (!title) {
      return res.status(400).json({
        status: "error",
        message: "Subtask title is required.",
      });
    }

    const { data, error } = await supabase
      .from("workspace_discussion_subtasks")
      .insert({
        topic_id: topicId,
        created_by: req.user.id,
        title,
        is_done: false,
        sort_order: Number(req.body.sortOrder || 0),
      })
      .select(
        `
        id,
        topic_id,
        created_by,
        title,
        is_done,
        sort_order,
        created_at,
        updated_at,
        creator:profiles!workspace_discussion_subtasks_created_by_fkey (
          id,
          email,
          username,
          full_name,
          avatar_url
        )
      `,
      )
      .single();

    if (error) throw error;

    return res.status(201).json({
      status: "success",
      data: mapDiscussionSubtask(data),
    });
  } catch (error) {
    console.error("addDiscussionSubtask error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not add subtask.",
      error: error.message,
    });
  }
};

exports.updateDiscussionSubtask = async (req, res) => {
  try {
    const { workspaceId, topicId, subtaskId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can update subtasks.",
      });
    }

    const topic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const updatePayload = {};
    if (req.body.title !== undefined) updatePayload.title = String(req.body.title || "").trim();
    if (req.body.isDone !== undefined) updatePayload.is_done = req.body.isDone === true || req.body.isDone === "true";
    if (req.body.sortOrder !== undefined) updatePayload.sort_order = Number(req.body.sortOrder || 0);
    updatePayload.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("workspace_discussion_subtasks")
      .update(updatePayload)
      .eq("id", subtaskId)
      .eq("topic_id", topicId)
      .select(
        `
        id,
        topic_id,
        created_by,
        title,
        is_done,
        sort_order,
        created_at,
        updated_at,
        creator:profiles!workspace_discussion_subtasks_created_by_fkey (
          id,
          email,
          username,
          full_name,
          avatar_url
        )
      `,
      )
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Subtask not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: mapDiscussionSubtask(data),
    });
  } catch (error) {
    console.error("updateDiscussionSubtask error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not update subtask.",
      error: error.message,
    });
  }
};

exports.deleteDiscussionSubtask = async (req, res) => {
  try {
    const { workspaceId, topicId, subtaskId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canWriteDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace editors and admins can delete subtasks.",
      });
    }

    const topic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const { error } = await supabase
      .from("workspace_discussion_subtasks")
      .delete()
      .eq("id", subtaskId)
      .eq("topic_id", topicId);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      message: "Subtask deleted.",
    });
  } catch (error) {
    console.error("deleteDiscussionSubtask error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not delete subtask.",
      error: error.message,
    });
  }
};

exports.addDiscussionAttachment = async (req, res) => {
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);
    const attachmentKind = req.body.kind === "solution" ? "solution" : "attachment";
    const isMemberUpload = req.body.source === "chat" || attachmentKind === "solution";
    const canAddAttachment = isMemberUpload
      ? access.canSubmitSolutions
      : access.canWriteDiscussion;

    if (!access.workspace || !canAddAttachment) {
      return res.status(403).json({
        status: "error",
        message: isMemberUpload
          ? "You cannot upload files to this topic."
          : "Only workspace editors and admins can add discussion attachments.",
      });
    }

    const topic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const fileName = String(req.body.fileName || "").trim();
    const fileUrl = String(req.body.fileUrl || "").trim();
    if (!fileName || !fileUrl) {
      return res.status(400).json({
        status: "error",
        message: "fileName and fileUrl are required.",
      });
    }

    const { data, error } = await supabase
      .from("workspace_discussion_attachments")
      .insert({
        topic_id: topicId,
        uploaded_by: req.user.id,
        file_name: fileName,
        file_url: fileUrl,
        file_size_bytes: Number(req.body.fileSizeBytes || 0),
        mime_type: attachmentKind === "solution"
          ? `solution:${String(req.body.solutionId || "").trim()}|${String(req.body.mimeType || "").trim()}`
          : String(req.body.mimeType || "").trim() || null,
      })
      .select(
        `
        id,
        topic_id,
        uploaded_by,
        file_name,
        file_url,
        file_size_bytes,
        mime_type,
        created_at,
        uploader:profiles!workspace_discussion_attachments_uploaded_by_fkey (
          id,
          email,
          username,
          full_name,
          avatar_url
        )
      `,
      )
      .single();

    if (error) throw error;

    return res.status(201).json({
      status: "success",
      data: mapDiscussionAttachment(data),
    });
  } catch (error) {
    console.error("addDiscussionAttachment error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not add discussion attachment.",
      error: error.message,
    });
  }
};
exports.uploadDiscussionAttachments = async (req, res) => {
  const uploadedPaths = [];
  try {
    const { workspaceId, topicId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);
    const attachmentKind = req.body.kind === "solution" ? "solution" : "attachment";
    const canUpload = attachmentKind === "solution"
      ? access.canSubmitSolutions
      : access.canWriteDiscussion;

    if (!access.workspace || !canUpload) {
      return res.status(403).json({ status: "error", message: "You cannot upload files to this topic." });
    }
    if (!(await getDiscussionTopicInWorkspace(workspaceId, topicId))) {
      return res.status(404).json({ status: "error", message: "Discussion topic not found." });
    }
    if (!req.files?.length) {
      return res.status(400).json({ status: "error", message: "Please select at least one file." });
    }

    req.files.forEach((file) => {
      file.originalname = normalizeUploadedFileName(file.originalname);
    });

    const rows = [];
    for (const file of req.files) {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${req.user.id}/workspace-discussions/${workspaceId}/${topicId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, file.buffer, { contentType: file.mimetype || "application/octet-stream" });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      rows.push({
        topic_id: topicId,
        uploaded_by: req.user.id,
        file_name: file.originalname,
        file_url: storagePath,
        file_size_bytes: file.size,
        mime_type: attachmentKind === "solution"
          ? `solution:${String(req.body.solutionId || "").trim()}|${file.mimetype || ""}`
          : file.mimetype || null,
      });
    }

    const { data, error } = await supabase
      .from("workspace_discussion_attachments")
      .insert(rows)
      .select(`id, topic_id, uploaded_by, file_name, file_url, file_size_bytes, mime_type, created_at,
        uploader:profiles!workspace_discussion_attachments_uploaded_by_fkey (id, email, username, full_name, avatar_url)`);
    if (error) throw error;

    return res.status(201).json({ status: "success", data: (data || []).map(mapDiscussionAttachment) });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths);
    }
    console.error("uploadDiscussionAttachments error:", error);
    return res.status(500).json({ status: "error", message: "Could not upload discussion attachments.", error: error.message });
  }
};
exports.viewDiscussionAttachment = async (req, res) => {
  try {
    const { workspaceId, topicId, attachmentId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canReadDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "You cannot view files in this workspace.",
      });
    }

    if (!(await getDiscussionTopicInWorkspace(workspaceId, topicId))) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const { data: attachment, error: attachmentError } = await supabase
      .from("workspace_discussion_attachments")
      .select("id, topic_id, file_name, file_url, file_size_bytes, mime_type")
      .eq("id", attachmentId)
      .eq("topic_id", topicId)
      .maybeSingle();

    if (attachmentError) throw attachmentError;
    if (!attachment) {
      return res.status(404).json({
        status: "error",
        message: "Attachment not found.",
      });
    }

    const shouldDownload = req.query.download === "true";
    const normalizedFileName = normalizeUploadedFileName(attachment.file_name);
    let viewUrl = attachment.file_url;
    if (!/^https?:\/\//i.test(viewUrl || "")) {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(
          attachment.file_url,
          60 * 60,
          shouldDownload ? { download: normalizedFileName } : undefined,
        );
      if (signedUrlError) throw signedUrlError;
      viewUrl = signedUrlData?.signedUrl;
    }

    return res.status(200).json({
      status: "success",
      data: {
        documentId: attachment.id,
        fileName: normalizedFileName,
        fileSizeBytes: attachment.file_size_bytes || 0,
        mimeType: attachment.mime_type,
        viewUrl,
        expiresIn: 60 * 60,
      },
    });
  } catch (error) {
    console.error("viewDiscussionAttachment error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not open this attachment.",
      error: error.message,
    });
  }
};

exports.deleteDiscussionAttachment = async (req, res) => {
  try {
    const { workspaceId, topicId, attachmentId } = req.params;
    const access = await getWorkspaceDiscussionAccess(workspaceId, req.user.id);

    if (!access.workspace || !access.canReadDiscussion) {
      return res.status(403).json({
        status: "error",
        message: "You cannot access this workspace discussion.",
      });
    }

    const topic = await getDiscussionTopicInWorkspace(workspaceId, topicId);
    if (!topic) {
      return res.status(404).json({
        status: "error",
        message: "Discussion topic not found.",
      });
    }

    const { data: attachment, error: attachmentError } = await supabase
      .from("workspace_discussion_attachments")
      .select("id, uploaded_by")
      .eq("id", attachmentId)
      .eq("topic_id", topicId)
      .maybeSingle();
    if (attachmentError) throw attachmentError;
    if (!attachment) return res.status(404).json({ status: "error", message: "Attachment not found." });
    if (!access.canWriteDiscussion && attachment.uploaded_by !== req.user.id) {
      return res.status(403).json({ status: "error", message: "You can only delete your own attachments." });
    }

    const { error } = await supabase
      .from("workspace_discussion_attachments")
      .delete()
      .eq("id", attachmentId)
      .eq("topic_id", topicId);

    if (error) throw error;

    return res.status(200).json({
      status: "success",
      message: "Discussion attachment deleted.",
    });
  } catch (error) {
    console.error("deleteDiscussionAttachment error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not delete discussion attachment.",
      error: error.message,
    });
  }
};

exports.updateWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;
    const { name, description } = req.body;

    const { workspace, isAdmin } = await getWorkspaceAccess(workspaceId, userId);
    if (!workspace) {
      return res.status(404).json({ status: "error", message: "Workspace not found." });
    }
    if (!isAdmin) {
      return res.status(403).json({ status: "error", message: "Only administrators can update this workspace." });
    }

    const updatePayload = {};
    if (typeof name === "string") {
      const cleanName = name.trim();
      if (!cleanName) {
        return res.status(400).json({
          status: "error",
          message: "Workspace name is required.",
        });
      }
      updatePayload.name = cleanName;
    }

    if (typeof description === "string") {
      updatePayload.description = description.trim() || null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No workspace fields were provided.",
      });
    }

    const { data, error } = await supabase
      .from("workspaces")
      .update(updatePayload)
      .eq("id", workspaceId)
      .select()
      .single();

    if (error) throw error;

    if (typeof updatePayload.name === "string" && updatePayload.name !== workspace.name) {
      await notifyWorkspaceMembers({
        workspaceId,
        actionType: "WORKSPACE_RENAMED",
        oldData: { name: workspace.name },
        newData: {
          name: updatePayload.name,
          notificationType: "renamed",
          changedBy: userId,
        },
        request: req,
        details: `Workspace "${workspace.name}" was renamed to "${updatePayload.name}".`,
      });
    }

    return res.status(200).json({ status: "success", data });
  } catch (error) {
    console.error("Lỗi updateWorkspace:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

exports.deleteWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    const { workspace, isAdmin } = await getWorkspaceAccess(workspaceId, userId);
    if (!workspace) {
      return res.status(404).json({ status: "error", message: "Workspace not found." });
    }
    if (!isAdmin) {
      return res.status(403).json({ status: "error", message: "Only administrators can delete this workspace." });
    }

    const { error } = await supabase
      .from("workspaces")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", workspaceId);

    if (error) throw error;

    await notifyWorkspaceMembers({
      workspaceId,
      actionType: "WORKSPACE_DELETED",
      oldData: { name: workspace.name },
      newData: {
        name: workspace.name,
        notificationType: "deleted",
        changedBy: userId,
      },
      request: req,
      details: `Workspace "${workspace.name}" was deleted.`,
    });

    return res.status(200).json({ status: "success", message: "Xóa workspace thành công." });
  } catch (error) {
    console.error("Lỗi deleteWorkspace:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

exports.respondToInvitation = async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { action } = req.body;
    const userId = req.user.id;

    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid action. Must be 'accept' or 'reject'.",
      });
    }

    const { data: inviteLog, error: logError } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("id", invitationId)
      .eq("user_id", userId)
      .eq("action_type", "WORKSPACE_INVITATION_PENDING")
      .maybeSingle();

    if (logError) throw logError;

    if (!inviteLog) {
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy thư mời hoặc bạn không có quyền phản hồi thư mời này.",
      });
    }

    const currentStatus = inviteLog.new_data?.status || "PENDING";
    if (currentStatus !== "PENDING") {
      return res.status(400).json({
        status: "error",
        message: `Thư mời này đã được ${currentStatus === "ACCEPTED" ? "chấp nhận" : "từ chối"} trước đó.`,
      });
    }

    const workspaceId = inviteLog.entity_id;
    const role = inviteLog.new_data?.role || "Viewer";
    const workspaceName = inviteLog.new_data?.workspaceName || "Workspace";

    const { data: targetWs } = await supabase
      .from("workspaces")
      .select("id, deleted_at")
      .eq("id", workspaceId)
      .maybeSingle();

    if (!targetWs || targetWs.deleted_at) {
      return res.status(400).json({
        status: "error",
        message: "This workspace has been deleted and is no longer available.",
      });
    }

    if (action === "accept") {
      const { error: insertError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          role,
        });

      if (insertError && insertError.code !== "23505") {
        throw insertError;
      }

      await supabase
        .from("activity_logs")
        .update({
          new_data: {
            ...inviteLog.new_data,
            status: "ACCEPTED",
          },
        })
        .eq("id", invitationId);

      const { data: userProfile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", userId)
        .maybeSingle();

      const userDisplayName = userProfile?.full_name || userProfile?.username || "A new member";

      const { data: adminsAndEditors } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .in("role", ["Admin", "Editor"])
        .neq("user_id", userId);

      if (adminsAndEditors && adminsAndEditors.length > 0) {
        const notifyRows = adminsAndEditors.map((m) => ({
          user_id: m.user_id,
          admin_id: userId,
          action_type: "WORKSPACE_ROLE_CHANGED",
          entity_type: "workspace",
          entity_id: workspaceId,
          new_data: {
            notificationType: "roleChanged",
            role,
            workspaceName,
          },
          details: `${userDisplayName} accepted the invitation and joined workspace "${workspaceName}" as ${getWorkspaceRoleLabel(role)}.`,
        }));

        await supabase.from("activity_logs").insert(notifyRows);
      }

      return res.status(200).json({
        status: "success",
        message: `Successfully joined workspace "${workspaceName}"!`,
        action: "ACCEPTED",
      });
    } else {
      await supabase
        .from("activity_logs")
        .update({
          new_data: {
            ...inviteLog.new_data,
            status: "REJECTED",
          },
        })
        .eq("id", invitationId);

      const { data: userProfile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", userId)
        .maybeSingle();

      const userDisplayName = userProfile?.full_name || userProfile?.username || "A user";

      const { data: adminsAndEditors } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .in("role", ["Admin", "Editor"])
        .neq("user_id", userId);

      const inviterId = inviteLog.new_data?.inviterId || inviteLog.admin_id;
      const targetAdminUserIds = new Set([
        ...(adminsAndEditors || []).map((m) => m.user_id),
        inviterId,
      ].filter((id) => id && id !== userId));

      if (targetAdminUserIds.size > 0) {
        const notifyRows = Array.from(targetAdminUserIds).map((targetId) => ({
          user_id: targetId,
          admin_id: userId,
          action_type: "WORKSPACE_ROLE_CHANGED",
          entity_type: "workspace",
          entity_id: workspaceId,
          new_data: {
            notificationType: "roleChanged",
            status: "REJECTED",
            workspaceName,
          },
          details: `${userDisplayName} declined the invitation to join workspace "${workspaceName}".`,
        }));

        await supabase.from("activity_logs").insert(notifyRows);
      }

      return res.status(200).json({
        status: "success",
        message: `Declined invitation to join workspace "${workspaceName}".`,
        action: "REJECTED",
      });
    }
  } catch (error) {
    console.error("respondToInvitation error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not process invitation response.",
      error: error.message,
    });
  }
};

exports.leaveWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    if (userId === "guest" || userId === "00000000-0000-0000-0000-000000000000" || req.user.role === "GUEST") {
      return res.status(403).json({
        status: "error",
        message: "Guest users cannot leave workspaces.",
      });
    }

    const access = await getWorkspaceAccess(workspaceId, userId);
    if (!access.workspace || !access.member) {
      return res.status(404).json({
        status: "error",
        message: "You are not a member of this workspace.",
      });
    }

    if (access.member.role === "Admin") {
      return res.status(400).json({
        status: "error",
        message: "You must transfer Admin ownership to another member before leaving this workspace.",
      });
    }

    const { error: deleteError } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);

    if (deleteError) throw deleteError;

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", userId)
      .maybeSingle();

    const userDisplayName = userProfile?.full_name || userProfile?.username || "A member";
    const workspaceName = access.workspace.name || "Workspace";

    const { data: adminsAndEditors } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .in("role", ["Admin", "Editor"])
      .neq("user_id", userId);

    if (adminsAndEditors && adminsAndEditors.length > 0) {
      const notifyRows = adminsAndEditors.map((m) => ({
        user_id: m.user_id,
        admin_id: userId,
        action_type: "WORKSPACE_MEMBER_LEFT",
        entity_type: "workspace",
        entity_id: workspaceId,
        new_data: {
          notificationType: "memberLeft",
          leftUserId: userId,
          workspaceName,
        },
        details: `${userDisplayName} has left workspace "${workspaceName}".`,
      }));

      await supabase.from("activity_logs").insert(notifyRows);
    }

    try {
      await supabase.from("workspace_messages").insert({
        workspace_id: workspaceId,
        sender_id: userId,
        content: `${userDisplayName} left the workspace.`,
      });
    } catch (msgErr) {
      console.warn("Could not insert left workspace message:", msgErr);
    }

    return res.status(200).json({
      status: "success",
      message: `Successfully left workspace "${workspaceName}".`,
    });
  } catch (error) {
    console.error("leaveWorkspace error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not leave workspace.",
      error: error.message,
    });
  }
};

exports.transferAdminOwnership = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { targetUserId } = req.body;
    const currentUserRole = req.body.currentUserRole === "Editor" ? "Editor" : "Viewer";
    const currentUserRolePhrase = currentUserRole === "Editor" ? "an Editor" : "a Contributor";
    const currentUserId = req.user.id;

    if (!targetUserId) {
      return res.status(400).json({
        status: "error",
        message: "targetUserId is required.",
      });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({
        status: "error",
        message: "You are already an Admin of this workspace.",
      });
    }

    const access = await getWorkspaceAccess(workspaceId, currentUserId);
    if (!access.workspace || !access.isAdmin) {
      return res.status(403).json({
        status: "error",
        message: "Only workspace Admins can transfer ownership.",
      });
    }

    const { data: targetMember, error: targetError } = await supabase
      .from("workspace_members")
      .select("role, user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!targetMember) {
      return res.status(404).json({
        status: "error",
        message: "Target user is not a member of this workspace.",
      });
    }

    let transferError = null;

    const { error: rpcError } = await supabase.rpc(
      "transfer_workspace_ownership",
      {
        p_workspace_id: workspaceId,
        p_current_owner_id: currentUserId,
        p_target_user_id: targetUserId,
      },
    );

    if (rpcError) {
      const isMissingRpc =
        rpcError.code === "PGRST202" ||
        String(rpcError.message).includes("does not exist") ||
        String(rpcError.message).includes("function");

      if (isMissingRpc) {
        // Fallback: Perform table updates directly using Service Role
        const { data: wsData, error: wsError } = await supabase
          .from("workspaces")
          .select("created_by")
          .eq("id", workspaceId)
          .is("deleted_at", null)
          .maybeSingle();

        if (wsError || !wsData) {
          return res.status(404).json({
            status: "error",
            message: "Workspace not found.",
          });
        }

        if (String(wsData.created_by) !== String(currentUserId)) {
          return res.status(403).json({
            status: "error",
            message: "Only the current workspace owner can transfer ownership.",
          });
        }

        // 1. Promote target user to Admin in workspace_members
        const { error: updateTargetError } = await supabase
          .from("workspace_members")
          .update({ role: "Admin" })
          .eq("workspace_id", workspaceId)
          .eq("user_id", targetUserId);

        if (updateTargetError) throw updateTargetError;

        // 2. Move the current owner to their selected non-admin role.
        const { error: updateOwnerError } = await supabase
          .from("workspace_members")
          .update({ role: currentUserRole })
          .eq("workspace_id", workspaceId)
          .eq("user_id", currentUserId);

        if (updateOwnerError) throw updateOwnerError;

        // 3. Update created_by in workspaces table
        const { error: updateWsOwnerError } = await supabase
          .from("workspaces")
          .update({ created_by: targetUserId })
          .eq("id", workspaceId);

        if (updateWsOwnerError) throw updateWsOwnerError;
      } else {
        transferError = rpcError;
      }
    }

    if (transferError) {
      if (String(transferError.message).includes("WORKSPACE_OWNER_REQUIRED")) {
        return res.status(403).json({
          status: "error",
          message: "Only the current workspace owner can transfer ownership.",
        });
      }
      if (String(transferError.message).includes("TARGET_MEMBER_NOT_FOUND")) {
        return res.status(404).json({
          status: "error",
          message: "Target user is not a member of this workspace.",
        });
      }
      throw transferError;
    }

    // The database RPC predates role selection and demotes to Viewer. Apply the
    // selected role after a successful transfer so both RPC and fallback paths
    // have the same result.
    const { error: selectedRoleError } = await supabase
      .from("workspace_members")
      .update({ role: currentUserRole })
      .eq("workspace_id", workspaceId)
      .eq("user_id", currentUserId);

    if (selectedRoleError) throw selectedRoleError;

    // Fetch profile names for notifications
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", [currentUserId, targetUserId]);

    const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name || p.username]));
    const currentAdminName = profileMap.get(currentUserId) || "Admin";
    const targetUserName = profileMap.get(targetUserId) || "Member";
    const workspaceName = access.workspace.name || "Workspace";

    // 3. Send notification letter to target user
    try {
      await supabase.from("activity_logs").insert({
        user_id: targetUserId,
        admin_id: currentUserId,
        action_type: "WORKSPACE_ROLE_CHANGED",
        entity_type: "workspace",
        entity_id: workspaceId,
        old_data: { role: targetMember.role },
        new_data: {
          role: "Admin",
          workspaceName,
          changedBy: currentUserId,
          notificationType: "roleChanged",
        },
        details: `You have been promoted to Admin of workspace "${workspaceName}". Admin ownership was transferred to you by ${currentAdminName}.`,
      });
    } catch (logError) {
      console.warn("Could not insert activity log for ownership transfer:", logError);
    }

    return res.status(200).json({
      status: "success",
      message: `Admin ownership transferred to ${targetUserName}. You are now ${currentUserRolePhrase}.`,
    });
  } catch (error) {
    console.error("transferAdminOwnership error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not transfer admin ownership.",
      error: error.message,
    });
  }
};

