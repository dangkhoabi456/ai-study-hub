import { Link, useLocation, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { createAppNotification } from "../../../utils/notificationStore.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addWorkspaceMember,
  addWorkspaceDiscussionComment,
  addWorkspaceDiscussionAttachment,
  addWorkspaceDiscussionSubtask,
  getWorkspaceMembers,
  getWorkspaceDiscussionTopics,
  removeWorkspaceMember,
  searchWorkspaceUsers,
  getWorkspace,
  updateWorkspace,
  updateWorkspaceDiscussionTopic,
  deleteWorkspaceDiscussionAttachment,
  deleteWorkspaceDiscussionSubtask,
  deleteWorkspaceDiscussionTopic,
  updateWorkspaceMemberRole,
  deleteWorkspace,
  getWorkspaceMessages,
  createWorkspaceMessage,
  getWorkspaceFlashcards,
  getWorkspaceDocuments,
  reviewWorkspaceDocument,
  generateWorkspaceDocumentFlashcards,
  createWorkspaceDiscussionTopic,
} from "../../../utils/workspaceApi";
import { deleteDocument, uploadDocuments } from "../../../utils/documentApi";
import { getStoredUser as getAuthStoredUser } from "../../../utils/authToken.js";
import "./WorkSpacePage.css";
import "../../../assets/icons/themify-icons-font/themify-icons/themify-icons.css";

function getInviteErrorMessage(error) {
  const status = error.response?.status;
  const backendMessage = error.response?.data?.message;

  if (status === 401) {
    return "Your login session is not valid anymore. Please log in again, then search users.";
  }

  if (status === 403) {
    return backendMessage || "Only workspace admins can add members.";
  }

  if (status === 409) {
    return backendMessage || "This user is already a member of the workspace.";
  }

  return backendMessage || "Cannot search users right now.";
}

function normalizeWorkspaceRole(role) {
  const value = String(role || "").trim().toLowerCase();

  if (value.includes("admin") || value.includes("manager") || value.includes("owner")) {
    return "admin";
  }

  if (value.includes("editor")) {
    return "editor";
  }

  return "viewer";
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function getStoredUserProfile() {
  return getAuthStoredUser();
}

function getStoredUserId(user) {
  return (
    user?.id ||
    user?._id ||
    user?.userId ||
    user?.user_id ||
    user?.profile?.id ||
    user?.user?.id ||
    user?.data?.id ||
    ""
  );
}

function getWorkspaceMemberRole(member) {
  return (
    member?.role ||
    member?.workspaceRole ||
    member?.workspace_role ||
    member?.permission ||
    member?.memberRole ||
    member?.pivot?.role ||
    ""
  );
}

function getWorkspaceMemberIdentities(member) {
  return [
    member?.email,
    member?.username,
    member?.full_name,
    member?.fullName,
    member?.name,
    member?.displayName,
    member?.user?.email,
    member?.user?.username,
    member?.user?.full_name,
    member?.user?.fullName,
    member?.user?.name,
    member?.user?.displayName,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function formatWorkspaceMessageTime(createdAt) {
  if (!createdAt) return "";

  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWorkspaceStudyDate(createdAt) {
  if (!createdAt) return "Recently updated";

  return `Updated ${new Date(createdAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })}`;
}

function formatWorkspaceFileSize(bytes) {
  const value = Number(bytes) || 0;

  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getDocumentStatusLabel(status) {
  const value = String(status || "PENDING").toUpperCase();

  if (value === "APPROVED") return "Approved";
  if (value === "FLAGGED") return "Flagged";
  if (value === "REJECTED") return "Rejected";
  if (value === "DELETED") return "Deleted";

  return "Pending";
}

function formatStudySessionDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildWorkspaceStudySets(flashcards) {
  const groupedCards = new Map();

  (flashcards || []).forEach((card) => {
    const groupId = card.documentId || "workspace-flashcards";
    const currentGroup = groupedCards.get(groupId) || {
      id: groupId,
      title: card.documentTitle || "Workspace flashcards",
      subtitle: card.documentTitle
        ? `Generated from ${card.documentTitle}`
        : "Generated workspace study cards",
      tag: card.documentStatus === "APPROVED" ? "Ready" : "",
      updatedAt: card.createdAt,
      cards: [],
    };

    currentGroup.cards.push({
      id: card.id,
      question: card.question,
      answer: card.answer,
    });

    if (
      card.createdAt &&
      (!currentGroup.updatedAt ||
        new Date(card.createdAt) > new Date(currentGroup.updatedAt))
    ) {
      currentGroup.updatedAt = card.createdAt;
    }

    groupedCards.set(groupId, currentGroup);
  });

  return Array.from(groupedCards.values()).map((studySet) => ({
    ...studySet,
    meta: `${studySet.cards.length} ${
      studySet.cards.length === 1 ? "Card" : "Cards"
    } · ${formatWorkspaceStudyDate(studySet.updatedAt)}`,
  }));
}

function getPendingInvitationsStorageKey(workspaceId) {
  return `aiStudyHubPendingInvitations:${workspaceId}`;
}

function loadPendingInvitations(workspaceId) {
  if (!workspaceId) return [];

  try {
    return JSON.parse(
      localStorage.getItem(getPendingInvitationsStorageKey(workspaceId)) ||
        "[]",
    );
  } catch (error) {
    console.error("Cannot read pending workspace invitations:", error);
    return [];
  }
}

function WorkSpacePage() {
  const WORKSPACE_NAME_MAX_LENGTH = 20;

  const { workspaceId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("discussion");
  const [isTopicFormOpen, setIsTopicFormOpen] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [editingTopicField, setEditingTopicField] = useState(null);
  const [topicContent, setTopicContent] = useState("");
  const [newTopicDescription, setNewTopicDescription] = useState("");
const [newTopicPriority, setNewTopicPriority] = useState("Normal");
const [newTopicDateMode, setNewTopicDateMode] = useState("none");
const [newTopicStartDate, setNewTopicStartDate] = useState("");
const [newTopicEndDate, setNewTopicEndDate] = useState("");
  const [topicCommentInput, setTopicCommentInput] = useState("");
  const [commentComposerMenu, setCommentComposerMenu] = useState(null);
const [topicSubtaskInput, setTopicSubtaskInput] = useState("");
const [isSubtaskEditing, setIsSubtaskEditing] = useState(false);
const [subtaskPriority, setSubtaskPriority] = useState("");
const [subtaskDateMode, setSubtaskDateMode] = useState("none");
const [subtaskStartDate, setSubtaskStartDate] = useState("");
const [subtaskEndDate, setSubtaskEndDate] = useState("");
const [isSubtaskDateOpen, setIsSubtaskDateOpen] = useState(false);
const [isSubtaskPriorityOpen, setIsSubtaskPriorityOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTopicId = searchParams.get("topic");
  const setSelectedTopicId = (id) => {
    if (id) {
      setSearchParams({ topic: id });
    } else {
      setSearchParams({});
    }
  };
  const [topicFilter, setTopicFilter] = useState("All");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");
  const [inviteStatus, setInviteStatus] = useState("idle");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [isInviteSearching, setIsInviteSearching] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [backendMembers, setBackendMembers] = useState([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberActionStatus, setMemberActionStatus] = useState("");
  const [memberActionId, setMemberActionId] = useState("");
  const [openRoleMenuId, setOpenRoleMenuId] = useState("");
  const [pendingInvitations, setPendingInvitations] = useState(() =>
    loadPendingInvitations(workspaceId),
  );
  const [candidateUsers, setCandidateUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [activeMemberProfileId, setActiveMemberProfileId] = useState("");

  useEffect(() => {
    setPendingInvitations(loadPendingInvitations(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    localStorage.setItem(
      getPendingInvitationsStorageKey(workspaceId),
      JSON.stringify(pendingInvitations),
    );
  }, [pendingInvitations, workspaceId]);

  useEffect(() => {
    if (!activeMemberProfileId) return;

    function closeActiveMemberProfile() {
      setActiveMemberProfileId("");
    }

    document.addEventListener("click", closeActiveMemberProfile);

    return () => {
      document.removeEventListener("click", closeActiveMemberProfile);
    };
  }, [activeMemberProfileId]);

  function handleViewMemberProfile(profileId) {
    if (!profileId) return;
    navigate(`/dashboard/profile/${profileId}`);
  }

  function handleToggleMemberProfile(event, profileId) {
    event.stopPropagation();
    if (!profileId) return;

    setActiveMemberProfileId((currentId) =>
      currentId === profileId ? "" : profileId,
    );
  }

  function handleWorkspaceNameChange(e) {
    const nextValue = e.target.value;

    if (nextValue.length > WORKSPACE_NAME_MAX_LENGTH) return;

    setWorkspaceNameInput(nextValue);

    if (nextValue.length === WORKSPACE_NAME_MAX_LENGTH) {
      setWorkspaceSettingMessage(
        `Workspace name has reached the limit of ${WORKSPACE_NAME_MAX_LENGTH} characters.`,
      );
      return;
    }

    setWorkspaceSettingMessage("");
  }
  const [messageText, setMessageText] = useState("");
  const [messageAttachment, setMessageAttachment] = useState(null);
  const [messageStatus, setMessageStatus] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [workspaceFlashcards, setWorkspaceFlashcards] = useState([]);
  const [workspaceDocuments, setWorkspaceDocuments] = useState([]);
  const [workspaceUploadFiles, setWorkspaceUploadFiles] = useState([]);
  const [workspaceDocumentStatus, setWorkspaceDocumentStatus] = useState("");
  const [deletingWorkspaceDocumentId, setDeletingWorkspaceDocumentId] = useState("");
  const [isUploadingWorkspaceDocuments, setIsUploadingWorkspaceDocuments] =
    useState(false);
  const [selectedStudyDocumentId, setSelectedStudyDocumentId] = useState("");
  const [isLoadingStudySets, setIsLoadingStudySets] = useState(false);
  const [isGeneratingStudyCards, setIsGeneratingStudyCards] = useState(false);
  const [studySetStatus, setStudySetStatus] = useState("");
  const [selectedStudySetId, setSelectedStudySetId] = useState("");
  const [currentStudyCardIndex, setCurrentStudyCardIndex] = useState(0);
  const [isStudyCardFlipped, setIsStudyCardFlipped] = useState(false);
  const [studySessionSeconds, setStudySessionSeconds] = useState(0);
  const [reviewedStudyCardIds, setReviewedStudyCardIds] = useState([]);

  const [workspace, setWorkspace] = useState(() => {
    return location.state?.workspace || null;
  });

  useEffect(() => {
    if (!workspaceId) return;

    let isMounted = true;

    if (!workspace || workspace.id !== workspaceId) {
      getWorkspace(workspaceId)
        .then((data) => {
          if (isMounted) {
            setWorkspace(data);
          }
        })
        .catch((err) => console.error("Cannot load workspace:", err));
    }

    getWorkspaceMembers(workspaceId)
      .then((members) => {
        if (isMounted) {
          setBackendMembers(members || []);
        }
      })
      .catch((error) => {
        console.error("Cannot load workspace members:", error);
      });

    return () => {
      isMounted = false;
    };
  }, [workspaceId, workspace]);

  const [workspaceNameInput, setWorkspaceNameInput] = useState(
    workspace?.name || "",
  );
  const [workspaceSettingMessage, setWorkspaceSettingMessage] = useState("");

  const storedUser = useMemo(() => getStoredUserProfile(), []);
  const currentUserId = String(getStoredUserId(storedUser) || "");
  const profileName =
    workspace?.owner ||
    storedUser?.displayName ||
    storedUser?.fullName ||
    storedUser?.full_name ||
    storedUser?.name ||
    storedUser?.username ||
      "Current user";

  const loadWorkspaceMembers = useCallback(async () => {
    if (!workspaceId) return;

    try {
      const members = await getWorkspaceMembers(workspaceId);
      setBackendMembers(members || []);
    } catch (error) {
      console.error("Cannot load workspace members:", error);
      setMemberActionStatus(
        error.response?.data?.message || "Could not load workspace members.",
      );
    }
  }, [workspaceId]);

  const currentUserIdentifiers = useMemo(
    () =>
      [
        profileName,
        storedUser?.email,
        storedUser?.username,
        storedUser?.full_name,
        storedUser?.fullName,
        storedUser?.name,
        storedUser?.displayName,
        storedUser?.user?.email,
        storedUser?.user?.username,
        storedUser?.user?.full_name,
        storedUser?.user?.fullName,
        storedUser?.user?.name,
        storedUser?.user?.displayName,
      ]
        .map(normalizeIdentity)
        .filter(Boolean),
    [profileName, storedUser],
  );

  const currentWorkspaceMember = useMemo(
    () =>
      backendMembers.find((member) =>
        getWorkspaceMemberIdentities(member).some((identity) =>
          currentUserIdentifiers.includes(identity),
        ),
      ),
    [backendMembers, currentUserIdentifiers],
  );

  const isWorkspaceOwner = useMemo(() => {
    const workspaceOwnerIdentifiers = [
      workspace?.owner,
      workspace?.ownerName,
      workspace?.ownerEmail,
      workspace?.createdBy,
      workspace?.creator,
      workspace?.user?.email,
      workspace?.user?.username,
    ]
      .map(normalizeIdentity)
      .filter(Boolean);

    return workspaceOwnerIdentifiers.some((identity) =>
      currentUserIdentifiers.includes(identity),
    );
  }, [currentUserIdentifiers, workspace]);

  const currentWorkspaceRole = normalizeWorkspaceRole(
    workspace?.myRole ||
      getWorkspaceMemberRole(currentWorkspaceMember) ||
      workspace?.currentUserRole ||
      workspace?.role ||
      workspace?.memberRole ||
      (isWorkspaceOwner || backendMembers.length === 0 ? "Admin" : "Viewer"),
  );

  const canManageTopics =
    currentWorkspaceRole === "editor" || currentWorkspaceRole === "admin";
  const canManageWorkspace = currentWorkspaceRole === "admin";
  const normalizedMemberSearch = normalizeIdentity(memberSearchQuery);

  const pendingInvitationUserIds = useMemo(
    () =>
      new Set(
        pendingInvitations
          .map((invitation) => invitation.userId)
          .filter(Boolean),
      ),
    [pendingInvitations],
  );

  const [chatMessages, setChatMessages] = useState([]);

  const [discussionTopics, setDiscussionTopics] = useState([]);
  const [discussionStatus, setDiscussionStatus] = useState("");
  const [isLoadingDiscussion, setIsLoadingDiscussion] = useState(false);

  const visibleWorkspaceMembers = useMemo(() => {
    const members = backendMembers.map((member) => ({
      id: member.user?.id,
      profileId: member.user?.id,
      name:
        member.user?.full_name ||
        member.user?.username ||
        "Workspace member",
      email: member.user?.email || member.user?.username || "",
      role: member.role || "Viewer",
      joinDate: member.joined_at
        ? new Date(member.joined_at).toLocaleDateString()
        : "Recently",
      avatar: "",
      isOnline: false,
    }));

    if (!normalizedMemberSearch) return members;

    return members.filter((member) =>
      [member.name, member.email, member.role]
        .join(" ")
        .toLowerCase()
        .includes(normalizedMemberSearch),
    );
  }, [backendMembers, normalizedMemberSearch]);

  useEffect(() => {
    if (!workspace?.name) return;
    setWorkspaceNameInput(workspace.name);
  }, [workspace?.name]);

  useEffect(() => {
    if (!workspaceId) return;

    let isMounted = true;

    async function loadDiscussionTopics() {
      try {
        setIsLoadingDiscussion(true);
        setDiscussionStatus("");
        const topics = await getWorkspaceDiscussionTopics(workspaceId);

        if (isMounted) {
          setDiscussionTopics(topics || []);
        }
      } catch (error) {
        console.error("Cannot load workspace discussion topics:", error);
        if (isMounted) {
          setDiscussionStatus(
            error.response?.data?.message ||
              "Could not load workspace discussion topics.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingDiscussion(false);
        }
      }
    }

    loadDiscussionTopics();

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    let isMounted = true;

    async function loadWorkspaceMessages() {
      try {
        setIsLoadingMessages(true);
        setMessageStatus("");
        const messages = await getWorkspaceMessages(workspaceId);

        if (!isMounted) return;

        setChatMessages(
          (messages || []).map((message) => {
            const senderMatchesCurrentUser = [
              message.senderEmail,
              message.senderName,
            ]
              .map(normalizeIdentity)
              .some((identity) =>
                identity && currentUserIdentifiers.includes(identity),
              );

            return {
            id: message.id,
            senderName: message.senderName,
            text: message.text,
            time: formatWorkspaceMessageTime(message.createdAt),
            isOwn:
              (currentUserId && String(message.senderId) === currentUserId) ||
              senderMatchesCurrentUser,
            avatar: message.senderAvatar || "",
            file: null,
            };
          }),
        );
      } catch (error) {
        console.error("Cannot load workspace messages:", error);
        if (isMounted) {
          setMessageStatus(
            error.response?.data?.message ||
              "Could not load workspace messages.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadWorkspaceMessages();

    return () => {
      isMounted = false;
    };
  }, [workspaceId, currentUserId]);

  const studySets = useMemo(
    () => buildWorkspaceStudySets(workspaceFlashcards),
    [workspaceFlashcards],
  );

  const approvedWorkspaceDocuments = useMemo(
    () =>
      workspaceDocuments.filter(
        (document) => String(document.status || "").toUpperCase() === "APPROVED",
      ),
    [workspaceDocuments],
  );

  const loadWorkspaceDocuments = useCallback(async () => {
    if (!workspaceId) return;

    try {
      const documents = await getWorkspaceDocuments(workspaceId);
      setWorkspaceDocuments(documents || []);
    } catch (error) {
      console.error("Cannot load workspace documents:", error);
      setWorkspaceDocumentStatus(
        error.response?.data?.message || "Could not load workspace documents.",
      );
      setWorkspaceDocuments([]);
    }
  }, [workspaceId]);

  const loadWorkspaceFlashcards = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoadingStudySets(true);
    setStudySetStatus("");

    try {
      const cards = await getWorkspaceFlashcards(workspaceId);
      setWorkspaceFlashcards(cards || []);
    } catch (error) {
      console.error("Cannot load workspace flashcards:", error);
      setStudySetStatus(
        error.response?.data?.message ||
          "Could not load workspace flashcards.",
      );
      setWorkspaceFlashcards([]);
    } finally {
      setIsLoadingStudySets(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadWorkspaceDocuments();
  }, [loadWorkspaceDocuments]);

  useEffect(() => {
    loadWorkspaceFlashcards();
  }, [loadWorkspaceFlashcards]);

  useEffect(() => {
    if (approvedWorkspaceDocuments.length === 0) {
      setSelectedStudyDocumentId("");
      return;
    }

    if (
      !approvedWorkspaceDocuments.some(
        (document) => document.id === selectedStudyDocumentId,
      )
    ) {
      setSelectedStudyDocumentId(approvedWorkspaceDocuments[0].id);
    }
  }, [approvedWorkspaceDocuments, selectedStudyDocumentId]);

  useEffect(() => {
    if (studySets.length === 0) {
      setSelectedStudySetId("");
      setCurrentStudyCardIndex(0);
      setIsStudyCardFlipped(false);
      setReviewedStudyCardIds([]);
      setStudySessionSeconds(0);
      return;
    }

    if (!studySets.some((studySet) => studySet.id === selectedStudySetId)) {
      setSelectedStudySetId(studySets[0].id);
      setCurrentStudyCardIndex(0);
      setIsStudyCardFlipped(false);
      setReviewedStudyCardIds([]);
      setStudySessionSeconds(0);
    }
  }, [selectedStudySetId, studySets]);

  useEffect(() => {
    if (activeTab !== "study" || !selectedStudySetId) return undefined;

    const timerId = window.setInterval(() => {
      setStudySessionSeconds((currentSeconds) => currentSeconds + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [activeTab, selectedStudySetId]);

  const selectedStudySet =
    studySets.find((studySet) => studySet.id === selectedStudySetId) ||
    null;
  const currentStudyCard =
    selectedStudySet?.cards[currentStudyCardIndex] ||
    selectedStudySet?.cards[0] ||
    null;

  useEffect(() => {
    if (activeTab !== "study" || !currentStudyCard?.id) return;

    setReviewedStudyCardIds((currentIds) =>
      currentIds.includes(currentStudyCard.id)
        ? currentIds
        : [...currentIds, currentStudyCard.id],
    );
  }, [activeTab, currentStudyCard?.id]);

  const WORKSPACE_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

  const discussionStorageUsedBytes = discussionTopics.reduce((total, topic) => {
    const topicFileSize = (topic.files || []).reduce(
      (fileTotal, file) =>
        fileTotal + (Number(file.fileSizeBytes || file.size) || 0),
      0,
    );

    return total + topicFileSize;
  }, 0);

const workspaceStorageUsedBytes = discussionStorageUsedBytes;
  const workspaceStorageRemainingBytes = Math.max(
    WORKSPACE_STORAGE_LIMIT_BYTES - workspaceStorageUsedBytes,
    0,
  );

  const workspaceStoragePercent = Math.min(
    (workspaceStorageUsedBytes / WORKSPACE_STORAGE_LIMIT_BYTES) * 100,
    100,
  );

  function formatWorkspaceStorageSize(bytes) {
    if (!bytes) return "0 KB";

    if (bytes < 1024 * 1024) {
      return `${Math.ceil(bytes / 1024)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (!workspace) {
    return (
      <main className="workspace_page">
        <section className="workspace_not_found">
          <div className="workspace_not_found_icon">
            <i className="ti-layout-grid2"></i>
          </div>

          <h1>Workspace not found</h1>
          <p>This workspace may have been deleted or the link is incorrect.</p>

          <Link to="/dashboard/workspaces">Back to My Workspaces</Link>
        </section>
      </main>
    );
  }

  const selectedTopic = discussionTopics.find(
    (topic) => topic.id === selectedTopicId,
  );

  /*
  const sampleStudySets = [
    {
      id: "software-architecture",
      title: "Software Architecture Basics",
      meta: "20 Cards · Updated 2h ago",
      tag: "Mastery",
      subtitle: "Focusing on high-availability and distributed systems",
      cards: [
        {
          question:
            "What is the primary purpose of a Load Balancer in a distributed system?",
          answer:
            "It distributes incoming traffic across multiple servers to improve availability, performance, and fault tolerance.",
        },
        {
          question:
            "What does high availability mean in software architecture?",
          answer:
            "It means the system is designed to remain accessible and operational with minimal downtime.",
        },
        {
          question: "Why do microservices usually need service discovery?",
          answer:
            "Because services can scale or move dynamically, so other services need a way to find their current network locations.",
        },
      ],
    },
    {
      id: "react-hooks",
      title: "React Hooks Mastery",
      meta: "45 Cards · Updated 1d ago",
      tag: "",
      subtitle: "Review useState, useEffect, useRef, and useContext",
      cards: [
        {
          question: "What is the main purpose of useEffect in React?",
          answer:
            "It runs side effects after render, such as fetching data, subscriptions, or DOM updates.",
        },
        {
          question: "When should you use useRef?",
          answer:
            "Use it to access DOM elements directly or store mutable values that should not trigger re-render.",
        },
      ],
    },
    {
      id: "database-normalization",
      title: "Database Normalization",
      meta: "12 Cards · Updated 3d ago",
      tag: "",
      subtitle: "Practice relational design and reducing redundancy",
      cards: [
        {
          question: "What is the goal of database normalization?",
          answer:
            "To organize data to reduce duplication and improve data integrity.",
        },
      ],
    },
    {
      id: "intro-algorithms",
      title: "Intro to Algorithms",
      meta: "30 Cards · Updated 1w ago",
      tag: "",
      subtitle: "Core algorithm concepts and complexity basics",
      cards: [
        {
          question: "What does Big-O notation describe?",
          answer:
            "It describes how an algorithm's time or space usage grows as input size increases.",
        },
      ],
    },
  ];
  */

  function getCurrentMessageTime() {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function requireTopicPermission(actionLabel) {
    if (canManageTopics) return true;

    alert(`Only workspace editors and admins can ${actionLabel}.`);
    return false;
  }

  function requireWorkspaceAdminPermission(actionLabel) {
    if (canManageWorkspace) return true;

    alert(`Only workspace admins can ${actionLabel}.`);
    return false;
  }

  async function handleCreateTopic(e) {
    e.preventDefault();

    if (!requireTopicPermission("create or edit topics")) return;

    if (topicTitle.trim() === "") {
      alert("Please enter topic title");
      return;
    }

    if (newTopicDescription.trim() === "") {
      alert("Please enter topic description");
      return;
    }

    try {
      setDiscussionStatus("");
      const createdTopic = await createWorkspaceDiscussionTopic(workspaceId, {
        title: topicTitle.trim(),
        content: newTopicDescription.trim(),
        topicType: "Question",
        status: "In progress",
        priority: newTopicPriority,
        dateMode: newTopicDateMode,
        startDate: newTopicDateMode === "deadline" ? newTopicStartDate : "",
        endDate: newTopicDateMode === "deadline" ? newTopicEndDate : "",
      });

      setDiscussionTopics((currentTopics) => [createdTopic, ...currentTopics]);
      createAppNotification({
        category: "discussion",
        action: "newTopic",
        title: "New discussion topic",
        message: `${profileName} created topic "${createdTopic.title}".`,
        icon: "ti-comments",
        link: `/dashboard/workspaces/${workspaceId}`,
      });
      setSelectedTopicId(createdTopic.id);

      setTopicTitle("");
      setTopicContent(createdTopic.content || "");

      setNewTopicDescription("");
      setNewTopicPriority("Normal");
      setNewTopicDateMode("none");
      setNewTopicStartDate("");
      setNewTopicEndDate("");

      setIsTopicFormOpen(false);
    } catch (error) {
      console.error("Cannot create discussion topic:", error);
      alert(error.response?.data?.message || "Could not create discussion topic.");
    }
  }

async function handleDeleteTopicFile(fileId) {
  if (!selectedTopic) return;
  if (!requireTopicPermission("delete topic files")) return;

  const savedFile = (selectedTopic.files || []).find(
    (file) => file.id === fileId,
  );

  const fileToDelete = savedFile;

  if (!fileToDelete) return;

  const confirmDelete = window.confirm(
    `Delete "${fileToDelete.fileName || fileToDelete.name}" from this topic?`,
  );

  if (!confirmDelete) return;

  // Xóa file đang chờ lưu
  try {
    await deleteWorkspaceDiscussionAttachment(
      workspaceId,
      selectedTopic.id,
      fileId,
    );

  // Xóa file đã lưu trong topic
    setDiscussionTopics((currentTopics) =>
      currentTopics.map((topic) =>
        topic.id === selectedTopic.id
          ? {
              ...topic,
              files: (topic.files || []).filter((file) => file.id !== fileId),
            }
          : topic,
      ),
    );
  } catch (error) {
    console.error("Cannot delete discussion attachment:", error);
    alert(error.response?.data?.message || "Could not delete attachment.");
  }
}

  async function handleDeleteSelectedTopic() {
    if (!selectedTopic) return;
    if (!requireTopicPermission("delete topics")) return;

    const confirmDelete = window.confirm(
      `Delete topic "${selectedTopic.title}"?`,
    );

    if (!confirmDelete) return;

    try {
      await deleteWorkspaceDiscussionTopic(workspaceId, selectedTopic.id);
      createAppNotification({
        category: "discussion",
        action: "topicDeleted",
        title: "Topic deleted",
        message: `Topic "${selectedTopic.title}" was deleted.`,
        icon: "ti-trash",
        link: `/dashboard/workspaces/${workspaceId}`,
      });
      setDiscussionTopics((currentTopics) =>
        currentTopics.filter((topic) => topic.id !== selectedTopic.id),
      );
      setSelectedTopicId(null);
      setTopicContent("");
    } catch (error) {
      console.error("Cannot delete discussion topic:", error);
      alert(error.response?.data?.message || "Could not delete topic.");
    }
  }

  async function uploadTopicFiles(e, { fromChat = false } = {}) {
    const selectedFiles = Array.from(e.target.files);

    if (selectedFiles.length === 0 || !selectedTopic) return;
    if (!fromChat && !requireTopicPermission("upload topic files")) {
      e.target.value = "";
      return;
    }

    const selectedFilesSize = selectedFiles.reduce(
      (total, file) => total + file.size,
      0,
    );

    const nextStorageUsed = workspaceStorageUsedBytes + selectedFilesSize;

if (nextStorageUsed > WORKSPACE_STORAGE_LIMIT_BYTES) {
  createAppNotification({
    category: "file",
    action: "storageWarning",
    title: "Workspace storage warning",
    message: "This workspace has reached the 50MB storage limit.",
    icon: "ti-alert",
    link: `/dashboard/workspaces/${workspaceId}`,
  });

  alert(
    "This workspace has reached the 50MB storage limit. You cannot upload more files.",
  );

  e.target.value = "";
  return;
}

    try {
      const uploadedDocuments = await uploadDocuments(selectedFiles, workspaceId);
      const attachments = await Promise.all(
        (uploadedDocuments || []).map((document) =>
          addWorkspaceDiscussionAttachment(workspaceId, selectedTopic.id, {
            fileName: document.title,
            fileUrl: document.fileUrl || document.file_url,
            fileSizeBytes: document.fileSizeBytes || document.file_size_bytes || 0,
            mimeType: document.mimeType || "",
            source: fromChat ? "chat" : "attachment",
          }),
        ),
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === selectedTopic.id
            ? { ...topic, files: [...(topic.files || []), ...attachments] }
            : topic,
        ),
      );

    } catch (error) {
      console.error("Cannot upload discussion attachments:", error);
      alert(error.response?.data?.message || "Could not upload discussion files.");
    } finally {
      e.target.value = "";
    }
  }

  function handleTopicFileChange(event) {
    return uploadTopicFiles(event);
  }

  function handleTopicChatFileChange(event) {
    return uploadTopicFiles(event, { fromChat: true });
  }

  async function handleSaveTopicNote(e) {
    e.preventDefault();

    if (!selectedTopic) return;
    if (!requireTopicPermission("edit topic content")) return;

    try {
      const updatedTopic = await updateWorkspaceDiscussionTopic(
        workspaceId,
        selectedTopic.id,
        {
          content: topicContent,
        },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === updatedTopic.id ? updatedTopic : topic,
        ),
      );
    } catch (error) {
      console.error("Cannot update discussion topic:", error);
      alert(error.response?.data?.message || "Could not update discussion topic.");
    }
  }

  async function handleUpdateTopicField(field, value) {
    if (!requireTopicPermission("edit topic properties")) return;

    const previousStatus = selectedTopic?.status;
    const payloadFieldMap = {
      type: "topicType",
      status: "status",
      priority: "priority",
    };

    try {
      const updatedTopic = await updateWorkspaceDiscussionTopic(
        workspaceId,
        selectedTopic.id,
        {
          [payloadFieldMap[field] || field]: value,
        },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === updatedTopic.id ? updatedTopic : topic,
        ),
      );

      if (field === "status" && value === "Solved" && previousStatus !== "Solved") {
        createAppNotification({
          category: "discussion",
          action: "solved",
          title: "Topic solved",
          message: `Topic "${selectedTopic.title}" was marked as solved.`,
          icon: "ti-check-box",
          link: `/dashboard/workspaces/${workspaceId}`,
        });
      }
    } catch (error) {
      console.error("Cannot update discussion topic field:", error);
      alert(error.response?.data?.message || "Could not update discussion topic.");
    }
  }

  async function handleMarkSelectedTopicResolved() {
    if (!selectedTopic || selectedTopic.status === "Solved") return;
    await handleUpdateTopicField("status", "Solved");
  }

  async function handleUpdateTopicDeadlineMode(value) {
    if (!requireTopicPermission("edit topic deadline")) return;

    try {
      const updatedTopic = await updateWorkspaceDiscussionTopic(
        workspaceId,
        selectedTopic.id,
        {
          dateMode: value,
          startDate: value === "deadline" ? selectedTopic.startDate : null,
          endDate: value === "deadline" ? selectedTopic.endDate : null,
        },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === updatedTopic.id ? updatedTopic : topic,
        ),
      );
    } catch (error) {
      console.error("Cannot update discussion deadline mode:", error);
      alert(error.response?.data?.message || "Could not update discussion topic.");
    }
  }

  async function handleUpdateTopicDate(field, value) {
    if (!requireTopicPermission("edit topic deadline")) return;

    try {
      const updatedTopic = await updateWorkspaceDiscussionTopic(
        workspaceId,
        selectedTopic.id,
        {
          dateMode: "deadline",
          [field]: value,
        },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === updatedTopic.id ? updatedTopic : topic,
        ),
      );
    } catch (error) {
      console.error("Cannot update discussion deadline date:", error);
      alert(error.response?.data?.message || "Could not update discussion topic.");
    }
  }

  async function handleAddTopicComment(e) {
    e.preventDefault();

    if (topicCommentInput.trim() === "") return;

    try {
      const comment = await addWorkspaceDiscussionComment(
        workspaceId,
        selectedTopic.id,
        { content: topicCommentInput.trim() },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === selectedTopic.id
            ? { ...topic, comments: [...(topic.comments || []), comment] }
            : topic,
        ),
      );
      setTopicCommentInput("");
    } catch (error) {
      console.error("Cannot add discussion comment:", error);
      alert(error.response?.data?.message || "Could not add comment.");
    }
  }

  function handleInsertTopicMention(name) {
    const mention = name === "everyone" ? "@everyone" : `@${name}`;

    setTopicCommentInput((currentValue) => {
      const separator = currentValue && !currentValue.endsWith(" ") ? " " : "";
      return `${currentValue}${separator}${mention} `;
    });
    setCommentComposerMenu(null);
  }

  async function handleAddTopicSubtask(e) {
    e.preventDefault();

    if (!requireTopicPermission("create subtasks")) return;

    if (topicSubtaskInput.trim() === "") return;

    try {
      const subtask = await addWorkspaceDiscussionSubtask(
        workspaceId,
        selectedTopic.id,
        {
          title: topicSubtaskInput.trim(),
          sortOrder: 0,
        },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === selectedTopic.id
            ? { ...topic, subtasks: [...(topic.subtasks || []), subtask] }
            : topic,
        ),
      );

      setTopicSubtaskInput("");
      setSubtaskPriority("");
      setSubtaskDateMode("none");
      setSubtaskStartDate("");
      setSubtaskEndDate("");
      setIsSubtaskEditing(false);
      setIsSubtaskPriorityOpen(false);
      setIsSubtaskDateOpen(false);
    } catch (error) {
      console.error("Cannot add discussion subtask:", error);
      alert(error.response?.data?.message || "Could not add subtask.");
    }
  }

function handleCancelSubtask() {
  setTopicSubtaskInput("");
  setSubtaskPriority("");
  setSubtaskDateMode("none");
  setSubtaskStartDate("");
  setSubtaskEndDate("");
  setIsSubtaskEditing(false);
  setIsSubtaskPriorityOpen(false);
  setIsSubtaskDateOpen(false);
}

  async function handleToggleSubtask(subtaskId) {
    if (!requireTopicPermission("update subtasks")) return;

    const subtask = selectedTopic?.subtasks?.find((item) => item.id === subtaskId);
    if (!subtask) return;

    try {
      const updatedSubtask = await updateWorkspaceDiscussionSubtask(
        workspaceId,
        selectedTopic.id,
        subtaskId,
        { isDone: !subtask.isDone },
      );

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === selectedTopic.id
            ? {
                ...topic,
                subtasks: (topic.subtasks || []).map((item) =>
                  item.id === subtaskId ? updatedSubtask : item,
                ),
              }
            : topic,
        ),
      );
    } catch (error) {
      console.error("Cannot update discussion subtask:", error);
      alert(error.response?.data?.message || "Could not update subtask.");
    }
  }

  async function handleDeleteSubtask(subtaskId) {
    if (!requireTopicPermission("delete subtasks")) return;

    try {
      await deleteWorkspaceDiscussionSubtask(workspaceId, selectedTopic.id, subtaskId);

      setDiscussionTopics((currentTopics) =>
        currentTopics.map((topic) =>
          topic.id === selectedTopic.id
            ? {
                ...topic,
                subtasks: (topic.subtasks || []).filter(
                  (subtask) => subtask.id !== subtaskId,
                ),
              }
            : topic,
        ),
      );
    } catch (error) {
      console.error("Cannot delete discussion subtask:", error);
      alert(error.response?.data?.message || "Could not delete subtask.");
    }
  }

function getSubtaskPriorityIcon(priority) {
  if (priority === "Urgent") return "🚩";
  if (priority === "High") return "🟧";
  if (priority === "Normal") return "🟦";
  if (priority === "Low") return "⬜";
  return "";
}

  function handleOpenInviteModal() {
    if (!requireWorkspaceAdminPermission("manage workspace members")) return;

    setInviteSuccess("");
    setIsInviteModalOpen(true);
  }

  function handleCloseInviteModal() {
    setIsInviteModalOpen(false);
    setInviteQuery("");
    setInviteRole("Viewer");
    setInviteStatus("idle");
    setCandidateUsers([]);
    setSelectedUserId("");
    setInviteError("");
    setIsInviteSearching(false);
    setIsAddingMember(false);
  }

  function handleInviteQueryChange(e) {
    setInviteQuery(e.target.value);
    setInviteStatus("idle");
    setCandidateUsers([]);
    setSelectedUserId("");
    setInviteError("");
  }

  async function handleSearchInviteMember() {
    if (!requireWorkspaceAdminPermission("search and invite workspace members")) {
      return;
    }

    const query = inviteQuery.trim().replace(/^@+/, "");

    if (query.length < 2) {
      setInviteError("Enter at least 2 characters to search.");
      return;
    }

    try {
      setIsInviteSearching(true);
      setInviteError("");
      const users = await searchWorkspaceUsers(workspaceId, query);
      const firstAvailableUser = users?.find((user) => !user.isWorkspaceMember);

      setCandidateUsers(users || []);
      setSelectedUserId(firstAvailableUser?.id || "");
      setInviteStatus(users?.length ? "found" : "not-found");
    } catch (error) {
      console.error("Cannot search workspace users:", error);
      setCandidateUsers([]);
      setSelectedUserId("");
      setInviteStatus("error");
      setInviteError(getInviteErrorMessage(error));
    } finally {
      setIsInviteSearching(false);
    }
  }

  async function handleSendInvite() {
    if (!requireWorkspaceAdminPermission("add workspace members")) return;

    if (inviteStatus !== "found" || !selectedUserId) return;

    try {
      setIsAddingMember(true);
      setInviteError("");
      const invitedUser = candidateUsers.find((user) => user.id === selectedUserId);
      const inviteResult = await addWorkspaceMember(workspaceId, {
        userId: selectedUserId,
        role: inviteRole,
      });

      const invitedName =
        invitedUser?.full_name ||
        invitedUser?.username ||
        invitedUser?.email ||
        "new member";
      const invitedEmail = invitedUser?.email || invitedUser?.username || invitedName;

      setPendingInvitations((currentInvitations) => {
        const nextInvitation = {
          userId: selectedUserId,
          email: invitedEmail,
          name: invitedName,
          role: inviteRole,
          invitedBy: profileName,
          time: "just now",
          createdAtMs: Date.now(),
        };

        return [
          nextInvitation,
          ...currentInvitations.filter(
            (invitation) => invitation.userId !== selectedUserId,
          ),
        ];
      });
      handleCloseInviteModal();
      await loadWorkspaceMembers();
      const emailWasSent = inviteResult?.emailSent;
      setInviteSuccess(
        emailWasSent
          ? `Added ${invitedName} to the workspace and sent an invitation email to ${invitedEmail}.`
          : `Added ${invitedName} to the workspace, but the invitation email could not be sent. Please check the backend email configuration.`,
      );
      createAppNotification({
        category: "member",
        action: "joined",
        title: emailWasSent ? "Workspace invite email sent" : "Workspace invite created",
        message: emailWasSent
          ? `${invitedName} has been invited by email to "${workspace?.name || "this workspace"}".`
          : `${invitedName} was added to "${workspace?.name || "this workspace"}", but the invite email was not sent.`,
        icon: "ti-user",
        link: `/dashboard/workspaces/${workspaceId}`,
      });
    } catch (error) {
      console.error("Cannot add workspace member:", error);
      setInviteError(getInviteErrorMessage(error));
    } finally {
      setIsAddingMember(false);
    }
  }

  async function handleUpdateMemberRole(userId, nextRole) {
    if (!userId || !nextRole) return;

    try {
      setOpenRoleMenuId("");
      setMemberActionId(userId);
      setMemberActionStatus("");

      await updateWorkspaceMemberRole(workspaceId, userId, { role: nextRole });
      await loadWorkspaceMembers();

      setMemberActionStatus(`Member role updated to ${nextRole}.`);
    } catch (error) {
      console.error("Cannot update workspace member role:", error);
      setMemberActionStatus(
        error.response?.data?.message || "Could not update member role.",
      );
    } finally {
      setMemberActionId("");
    }
  }

  async function handleRemoveWorkspaceMember(userId, memberName) {
    if (!userId) return;

    const isConfirmed = window.confirm(
      `Remove ${memberName || "this member"} from the workspace?`,
    );

    if (!isConfirmed) return;

    try {
      setMemberActionId(userId);
      setMemberActionStatus("");

      await removeWorkspaceMember(workspaceId, userId);
      await loadWorkspaceMembers();

      setMemberActionStatus("Member removed from workspace.");
    } catch (error) {
      console.error("Cannot remove workspace member:", error);
      setMemberActionStatus(
        error.response?.data?.message || "Could not remove member.",
      );
    } finally {
      setMemberActionId("");
    }
  }

  function handleResendPendingInvitation(invitation) {
    if (!invitation) return;

    setPendingInvitations((currentInvitations) =>
      currentInvitations.map((item) =>
        (item.id || item.email) === (invitation.id || invitation.email)
          ? {
              ...item,
              time: "just now",
              resentAtMs: Date.now(),
            }
          : item,
      ),
    );

    setMemberActionStatus(
      `Resent invitation for ${invitation.name || invitation.email}.`,
    );
  }

  function handleMessageAttachmentChange(e) {
    setMessageStatus("Message attachments are not available until workspace file-message storage is added.");
    e.target.value = "";
  }

  function handleRemoveMessageAttachment() {
    if (messageAttachment?.previewUrl) {
      URL.revokeObjectURL(messageAttachment.previewUrl);
    }

    setMessageAttachment(null);
  }

  async function handleSendMessage() {
    const trimmedMessage = messageText.trim();

    if (trimmedMessage === "") return;

    try {
      setIsSendingMessage(true);
      setMessageStatus("");

      const savedMessage = await createWorkspaceMessage(workspaceId, {
        content: trimmedMessage,
      });

    const newMessage = {
      id: savedMessage.id,
      senderName: savedMessage.senderName || profileName,
      text: savedMessage.text,
      time: getCurrentMessageTime(),
      isOwn: true,
      file: messageAttachment
        ? {
            name: messageAttachment.name,
            sizeLabel: messageAttachment.sizeLabel,
            isImage: messageAttachment.isImage,
            previewUrl: messageAttachment.previewUrl,
          }
        : null,
    };

    setChatMessages((currentMessages) => [...currentMessages, newMessage]);
    setMessageText("");
    setMessageAttachment(null);
    } catch (error) {
      console.error("Cannot send workspace message:", error);
      setMessageStatus(
        error.response?.data?.message || "Could not send workspace message.",
      );
    } finally {
      setIsSendingMessage(false);
    }
  }

  function handleMessageKeyDown(e) {
    if (e.key !== "Enter" || e.shiftKey) return;

    e.preventDefault();
    handleSendMessage();
  }

  async function handleRenameWorkspace(e) {
    e.preventDefault();

    if (!requireWorkspaceAdminPermission("rename this workspace")) return;

    const rawName = workspaceNameInput;
    const trimmedName = rawName.trim();

    if (trimmedName === "") {
      setWorkspaceSettingMessage("Workspace name cannot be empty.");
      return;
    }

    if (rawName.length > WORKSPACE_NAME_MAX_LENGTH) {
      setWorkspaceSettingMessage(
        `Workspace name cannot exceed ${WORKSPACE_NAME_MAX_LENGTH} characters.`,
      );
      return;
    }

    try {
      const previousName = workspace?.name || "Workspace";
      await updateWorkspace(workspaceId, { name: trimmedName });
      setWorkspace((current) => ({ ...current, name: trimmedName }));
      setWorkspaceNameInput(trimmedName);
      setWorkspaceSettingMessage("Workspace name updated successfully.");

      if (previousName !== trimmedName) {
        createAppNotification({
          category: "workspace",
          action: "nameChanged",
          title: "Workspace name changed",
          message: `"${previousName}" was renamed to "${trimmedName}".`,
          icon: "ti-pencil-alt",
          link: `/dashboard/workspaces/${workspaceId}`,
        });
      }
    } catch (err) {
      console.error("Failed to update workspace name:", err);
      setWorkspaceSettingMessage("Failed to update workspace name on server.");
    }
  }

  async function handleDeleteWorkspace() {
    if (!requireWorkspaceAdminPermission("delete this workspace")) return;

    const isConfirmed = window.confirm(
      "Are you sure you want to delete this workspace?",
    );

    if (!isConfirmed) return;

    try {
      const deletedWorkspaceName = workspace?.name || "Workspace";
      await deleteWorkspace(workspaceId);

      createAppNotification({
        category: "workspace",
        action: "deleted",
        title: "Workspace deleted",
        message: `Workspace "${deletedWorkspaceName}" was deleted.`,
        icon: "ti-trash",
        link: "/dashboard/workspaces",
      });

      navigate("/dashboard/workspaces");
    } catch (err) {
      console.error("Failed to delete workspace:", err);
      alert("Failed to delete workspace on server.");
    }
  }

  function handleSelectStudySet(studySetId) {
    setSelectedStudySetId(studySetId);
    setCurrentStudyCardIndex(0);
    setIsStudyCardFlipped(false);
    setReviewedStudyCardIds([]);
    setStudySessionSeconds(0);
  }

  async function handleGenerateWorkspaceFlashcards() {
    if (!selectedStudyDocumentId || isGeneratingStudyCards) return;

    try {
      setIsGeneratingStudyCards(true);
      setStudySetStatus("Generating flashcards from the selected document...");

      const generatedCards = await generateWorkspaceDocumentFlashcards(
        selectedStudyDocumentId,
      );

      await loadWorkspaceFlashcards();

      setStudySetStatus(
        `${generatedCards?.length || 0} flashcards generated successfully.`,
      );
    } catch (error) {
      console.error("Cannot generate workspace flashcards:", error);
      setStudySetStatus(
        error.response?.data?.message ||
          "Could not generate flashcards for this document.",
      );
    } finally {
      setIsGeneratingStudyCards(false);
    }
  }

  function handleWorkspaceDocumentFileChange(event) {
    setWorkspaceUploadFiles(Array.from(event.target.files || []));
    setWorkspaceDocumentStatus("");
  }

  async function handleUploadWorkspaceDocuments() {
    if (workspaceUploadFiles.length === 0 || isUploadingWorkspaceDocuments) {
      return;
    }

    try {
      setIsUploadingWorkspaceDocuments(true);
      setWorkspaceDocumentStatus("Uploading workspace documents...");

      const uploadedDocuments = await uploadDocuments(
        workspaceUploadFiles,
        workspaceId,
        null,
        [],
      );

      setWorkspaceUploadFiles([]);
      await loadWorkspaceDocuments();

      const hasFlagged = (uploadedDocuments || []).some(
        (document) => document.status === "FLAGGED",
      );

      setWorkspaceDocumentStatus(
        hasFlagged
          ? "Upload completed. Some documents were flagged for review."
          : "Workspace documents uploaded and waiting for workspace admin review.",
      );
    } catch (error) {
      console.error("Workspace document upload failed:", error);
      setWorkspaceDocumentStatus(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Could not upload workspace documents.",
      );
    } finally {
      setIsUploadingWorkspaceDocuments(false);
    }
  }

  async function handleReviewWorkspaceDocument(documentId, decision) {
    if (!canManageWorkspace) {
      setWorkspaceDocumentStatus(
        "Only workspace admins can review workspace documents.",
      );
      return;
    }

    try {
      const updatedDocument = await reviewWorkspaceDocument(
        workspaceId,
        documentId,
        {
          decision,
          reason:
            decision === "APPROVE"
              ? "Approved by workspace admin."
              : "Rejected by workspace admin.",
        },
      );

      setWorkspaceDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === documentId ? updatedDocument : document,
        ),
      );
      await loadWorkspaceDocuments();

      setWorkspaceDocumentStatus(
        decision === "APPROVE"
          ? "Document approved for workspace study tools."
          : "Document rejected by workspace admin.",
      );
    } catch (error) {
      console.error("Workspace document review failed:", error);
      setWorkspaceDocumentStatus(
        error.response?.data?.message ||
          "Could not save workspace document review.",
      );
    }
  }

  async function handleDeleteWorkspaceDocument(document) {
    if (!document?.id) return;

    const isConfirmed = window.confirm(
      `Delete "${document.title || "this document"}" from the workspace?`,
    );

    if (!isConfirmed) return;

    try {
      setDeletingWorkspaceDocumentId(document.id);
      setWorkspaceDocumentStatus("");
      await deleteDocument(document.id);
      setWorkspaceDocuments((currentDocuments) =>
        currentDocuments.filter((item) => item.id !== document.id),
      );
      setWorkspaceDocumentStatus("Document deleted successfully.");
    } catch (error) {
      console.error("Cannot delete workspace document:", error);
      setWorkspaceDocumentStatus(
        error.response?.data?.message || "Could not delete workspace document.",
      );
    } finally {
      setDeletingWorkspaceDocumentId("");
    }
  }

  function handlePreviousStudyCard() {
    if (!selectedStudySet?.cards?.length) return;

    setCurrentStudyCardIndex((currentIndex) =>
      currentIndex === 0 ? selectedStudySet.cards.length - 1 : currentIndex - 1,
    );
    setIsStudyCardFlipped(false);
  }

  function handleNextStudyCard() {
    if (!selectedStudySet?.cards?.length) return;

    setCurrentStudyCardIndex((currentIndex) =>
      currentIndex === selectedStudySet.cards.length - 1 ? 0 : currentIndex + 1,
    );
    setIsStudyCardFlipped(false);
  }

  function renderMessagesTab() {
    return (
      <section className="workspace_message_tab">
        <header className="workspace_message_header">
          <div>
            <h2>
              {workspaceNameInput || workspace.name || "Workspace Group Chat"}
            </h2>
            <p>
              <span></span>
              {backendMembers.length || 1} member
              {(backendMembers.length || 1) === 1 ? "" : "s"} in workspace
            </p>
          </div>

          <div className="workspace_message_header_actions">
            <button type="button" aria-label="View members">
              <i className="ti-user"></i>
            </button>

            <button type="button" aria-label="Conversation information">
              <i className="ti-info-alt"></i>
            </button>

          </div>
        </header>

        <div className="workspace_message_day">Today</div>

        <section className="workspace_message_body">
          {isLoadingMessages ? (
            <div className="workspace_message_empty">
              <i className="ti-reload"></i>
              <h3>Loading messages...</h3>
              <p>Please wait while this workspace conversation loads.</p>
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="workspace_message_empty">
              <i className="ti-comment-alt"></i>
              <h3>No messages yet</h3>
              <p>Start the first conversation in this workspace.</p>
            </div>
          ) : (
          chatMessages.map((message) => (
            <article
              className={`workspace_message_item ${message.isOwn ? "own" : ""}`}
              key={message.id}
            >
              {!message.isOwn && (
                <div
                  className="workspace_message_avatar"
                  aria-label={`${message.senderName} avatar`}
                >
                  <span aria-hidden="true">
                    {(message.senderName || "U").trim().charAt(0).toUpperCase()}
                  </span>
                  {message.avatar && (
                    <img
                      src={message.avatar}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </div>
              )}

              <div className="workspace_message_content_area">
                <h3 className={message.isOwn ? "workspace_message_you" : ""}>
                  {message.isOwn ? "You" : message.senderName}
                </h3>

                {message.text && (
                  <div
                    className={`workspace_message_bubble ${
                      message.isOwn ? "sent" : "received"
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                {message.file && message.file.isImage && (
                  <div
                    className={`workspace_message_bubble image ${
                      message.isOwn ? "sent" : "received"
                    }`}
                  >
                    <img
                      src={message.file.previewUrl}
                      alt={message.file.name}
                    />
                  </div>
                )}

                {message.file && !message.file.isImage && (
                  <div className="workspace_message_file">
                    <div>
                      <i className="ti-file"></i>
                    </div>

                    <section>
                      <strong>{message.file.name}</strong>
                      <span>{message.file.sizeLabel}</span>
                    </section>
                  </div>
                )}

                <span
                  className={`workspace_message_time ${
                    message.isOwn ? "own" : ""
                  }`}
                >
                  {message.time} · {message.isOwn ? "Sent" : "Received"}
                </span>
              </div>
            </article>
          ))
          )}
        </section>

        {messageAttachment && (
          <div className="workspace_message_selected_file">
            <div>
              <i
                className={messageAttachment.isImage ? "ti-image" : "ti-file"}
              ></i>
              <span>
                {messageAttachment.name} · {messageAttachment.sizeLabel}
              </span>
            </div>

            <button type="button" onClick={handleRemoveMessageAttachment}>
              ×
            </button>
          </div>
        )}

        <section className="workspace_message_composer">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleMessageKeyDown}
            placeholder="Type your message here..."
            disabled={isSendingMessage}
          />

          <div className="workspace_message_composer_actions">
            <div>
              <label title="Attach file">
                <i className="ti-clip"></i>
                <input type="file" onChange={handleMessageAttachmentChange} />
              </label>

              <button type="button" aria-label="Add emoji">
                <i className="ti-face-smile"></i>
              </button>
            </div>

            <button
              type="button"
              className="workspace_message_send_btn"
              onClick={handleSendMessage}
              aria-label="Send message"
              disabled={isSendingMessage || messageText.trim() === ""}
            >
              <i className="ti-control-play"></i>
            </button>
          </div>
        </section>

        <p className="workspace_message_hint">
          {messageStatus || "Press Enter to send, Shift + Enter for new line"}
        </p>
      </section>
    );
  }

  function renderMembersTab() {
    const adminCount = visibleWorkspaceMembers.filter(
      (member) => member.role === "Admin",
    ).length;

    return (
      <section className="workspace_member_tab">
        <section className="workspace_member_main">
          <div className="workspace_member_top">
            <div>
              <h2>Workspace Members</h2>
              <p>
                {canManageWorkspace
                  ? "Manage access and roles for this academic resource center."
                  : "View members and roles in this academic resource center."}
              </p>
            </div>

            {canManageWorkspace && (
              <div className="workspace_member_actions">
                <div className="workspace_member_search">
                  <i className="ti-search"></i>
                  <input
                    type="text"
                    placeholder="Search members..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                  />
                </div>

                <button type="button" onClick={handleOpenInviteModal}>
                  <i className="ti-user"></i>
                  Add Member
                </button>
              </div>
            )}
          </div>

          {inviteSuccess && (
            <div className="workspace_invite_success" role="status">
              <i className="ti-check-box"></i>
              <span>{inviteSuccess}</span>
              <button type="button" onClick={() => setInviteSuccess("")}>
                ×
              </button>
            </div>
          )}

          {memberActionStatus && (
            <div className="workspace_invite_success" role="status">
              <i className="ti-info-alt"></i>
              <span>{memberActionStatus}</span>
              <button type="button" onClick={() => setMemberActionStatus("")}>
                ×
              </button>
            </div>
          )}

          <div className="workspace_member_table">
            <div className="workspace_member_table_header">
              <span>Member</span>
              <span>Role</span>
              <span>Join Date</span>
              <span>Actions</span>
            </div>

            {visibleWorkspaceMembers.length === 0 ? (
              <div className="workspace_member_empty">
                <i className="ti-user"></i>
                <p>No members were returned for this workspace.</p>
              </div>
            ) : visibleWorkspaceMembers.map((member) => {
              const canViewProfile = Boolean(member.profileId || member.id);
              const profileId = member.profileId || member.id;
              const isProfileOptionActive = activeMemberProfileId === profileId;
              const isCurrentUser = currentUserId
                ? String(member.id) === currentUserId
                : false;
              const isLastAdmin = member.role === "Admin" && adminCount <= 1;
              const isActionBusy = memberActionId === member.id;

              return (
                <article
                  className="workspace_member_row"
                  key={member.id || member.email || member.name}
                >
                  <div className="workspace_member_identity">
                    <div
                      className={`workspace_member_profile_trigger ${
                        canViewProfile ? "" : "is-disabled"
                      } ${isProfileOptionActive ? "is-active" : ""}`}
                      role={canViewProfile ? "button" : undefined}
                      tabIndex={canViewProfile ? 0 : undefined}
                      onClick={(event) =>
                        handleToggleMemberProfile(event, profileId)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleToggleMemberProfile(event, profileId);
                        }
                      }}
                    >
                      <div className="workspace_member_avatar">
                        {member.avatar ? (
                          <img src={member.avatar} alt={member.name} />
                        ) : (
                          <i className="ti-user"></i>
                        )}

                        {member.isOnline && <span></span>}
                      </div>

                      <div className="workspace_member_profile_text">
                        <strong>{member.name}</strong>
                        <p>{member.email}</p>
                      </div>

                      {canViewProfile && (
                        <button
                          type="button"
                          className="workspace_member_profile_option"
                          tabIndex={isProfileOptionActive ? 0 : -1}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleViewMemberProfile(profileId);
                          }}
                        >
                          <i className="ti-id-badge"></i>
                          View profile
                        </button>
                      )}
                    </div>
                  </div>

                  <span
                    className={`workspace_member_status ${
                      member.role === "Admin"
                        ? "manager"
                        : member.role === "Editor"
                          ? "editor"
                          : "member"
                    }`}
                  >
                    {member.role}
                  </span>

                  <span className="workspace_member_join_date">
                    {member.joinDate}
                  </span>

                  {canManageWorkspace ? (
                    <div className="workspace_member_admin_actions">
                      {member.role !== "Admin" && (
                        <div
                          className="workspace_role_dropdown"
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget)) {
                              setOpenRoleMenuId("");
                            }
                          }}
                        >
                          <button
                            type="button"
                            className={`workspace_role_trigger role_${member.role.toLowerCase()}`}
                            disabled={isActionBusy}
                            aria-haspopup="listbox"
                            aria-expanded={openRoleMenuId === member.id}
                            aria-label={`Change role for ${member.name}`}
                            onClick={() =>
                              setOpenRoleMenuId((currentId) =>
                                currentId === member.id ? "" : member.id,
                              )
                            }
                          >
                            <span>{member.role}</span>
                            <i className="ti-angle-down" aria-hidden="true"></i>
                          </button>

                          {openRoleMenuId === member.id && (
                            <div className="workspace_role_menu" role="listbox">
                              {["Editor", "Viewer"].map((role) => (
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={member.role === role}
                                  className={member.role === role ? "selected" : ""}
                                  key={role}
                                  onClick={() => handleUpdateMemberRole(member.id, role)}
                                >
                                  <span className={`workspace_role_dot role_${role.toLowerCase()}`}></span>
                                  <span>{role}</span>
                                  {member.role === role && (
                                    <i className="ti-check" aria-hidden="true"></i>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={isActionBusy || isCurrentUser || isLastAdmin}
                        onClick={() =>
                          handleRemoveWorkspaceMember(member.id, member.name)
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="workspace_member_readonly_action">
                      View only
                    </span>
                  )}
                </article>
              );
            })}
          </div>

          {canManageWorkspace && (
            <section className="workspace_pending_card">
              <div className="workspace_pending_header">
                <h3>Pending Invitations</h3>
                <span>
                  <strong>{pendingInvitations.length}</strong> Pending
                </span>
              </div>

              <div className="workspace_pending_list">
                {pendingInvitations.length > 0 ? (
                  pendingInvitations.map((invitation) => (
                    <article
                      className="workspace_pending_item"
                      key={invitation.id || invitation.email}
                    >
                      <div className="workspace_pending_mail_icon">
                        <i className="ti-email"></i>
                      </div>

                      <div className="workspace_pending_info">
                        <strong>{invitation.name || invitation.email}</strong>
                        <p>
                          Invited {invitation.time} by {invitation.invitedBy}
                          {invitation.role ? ` as ${invitation.role}` : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleResendPendingInvitation(invitation)}
                      >
                        Resend
                      </button>
                    </article>
                  ))
                ) : (
                  <div className="workspace_pending_empty">
                    <i className="ti-check-box"></i>
                    <p>No pending invitations right now.</p>
                  </div>
                )}
              </div>
            </section>
          )}

        </section>

        <aside className="workspace_member_sidebar">
          <section className="workspace_side_card">
            <h3>About Roles</h3>

            <div className="workspace_role_item">
              <strong>Managers</strong>
              <p>
                Can edit library settings, upload documents, and manage members.
              </p>
            </div>

            <div className="workspace_role_item">
              <strong>Members</strong>
              <p>
                Can view documents, participate in AI chats, and contribute to
                folders.
              </p>
            </div>
          </section>

          <section className="workspace_side_card">
            <div className="workspace_side_title">
              <h3>Activity</h3>
              <i className="ti-stats-up"></i>
            </div>

            <div className="workspace_activity_stats">
              <div>
                <strong>{discussionTopics.length}</strong>
                <span>Topics</span>
              </div>

              <div>
                <strong>{visibleWorkspaceMembers.length}</strong>
                <span>Members</span>
              </div>
            </div>
          </section>

          <section className="workspace_side_card">
            <h3>Latest Activity</h3>

            <div className="workspace_latest_activity highlight">
              <strong>{discussionTopics[0]?.creator || "Workspace"}</strong>
              <p>
                {discussionTopics[0]
                  ? `created "${discussionTopics[0].title}"`
                  : "No discussion activity yet."}
              </p>
              <span>{discussionTopics[0]?.createdAt || "No activity"}</span>
            </div>

            <div className="workspace_latest_activity">
              <strong>{profileName}</strong>
              <p>joined the workspace.</p>
              <span>Current session</span>
            </div>
          </section>
        </aside>
      </section>
    );
  }

  function renderDiscussionTab() {
    const totalTopicFiles = discussionTopics.reduce(
      (total, topic) => total + (topic.files?.length || 0),
      0,
    );
const filteredDiscussionTopics = discussionTopics.filter((topic) => {
  if (topicFilter === "All") return true;
  return topic.status === "Solved";
});
    if (selectedTopic) {
  const relatedFiles = selectedTopic.files || [];
  const comments = selectedTopic.comments || [];
  const subtasks = selectedTopic.subtasks || [];
  const topicDeadlineText =
  selectedTopic.dateMode === "deadline"
    ? `${selectedTopic.startDate || "No start date"} → ${
        selectedTopic.endDate || "No end date"
      }`
    : "No deadline";
  return (
    <section className="workspace_clickup_detail">
      <main className="workspace_clickup_main">
        <header className="workspace_clickup_header">
          <button
            type="button"
            className="workspace_clickup_back"
            onClick={() => setSelectedTopicId(null)}
          >
            <i className="ti-angle-left"></i>
            Back to topics
          </button>

          <div className="workspace_clickup_title">
            <span className="workspace_clickup_status_dot"></span>

            <h1>
              {selectedTopic.title}
            </h1>

          {canManageTopics && (
            <div className="workspace_topic_header_actions">
              <button
                type="button"
                className="workspace_topic_resolve_btn"
                onClick={handleMarkSelectedTopicResolved}
                disabled={selectedTopic.status === "Solved"}
              >
                <i className="ti-check-box" aria-hidden="true"></i>
                {selectedTopic.status === "Solved" ? "Resolved" : "Mark as resolved"}
              </button>

              <button
                type="button"
                className="workspace_topic_delete_btn"
                onClick={handleDeleteSelectedTopic}
              >
                <i className="ti-trash" aria-hidden="true"></i>
                Delete topic
              </button>
            </div>
          )}
        </header>

<section className="workspace_topic_info_panel">
  <button
    type="button"
    className={`workspace_topic_info_item ${
      canManageTopics ? "editable" : "read_only"
    }`}
    onClick={() => canManageTopics && setEditingTopicField("priority")}
    disabled={!canManageTopics}
  >
    <span>
      <i className="ti-flag-alt"></i>
      Priority
    </span>

    {canManageTopics && editingTopicField === "priority" ? (
      <select
        value={selectedTopic.priority || "Normal"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleUpdateTopicField("priority", e.target.value);
          setEditingTopicField(null);
        }}
        onBlur={() => setEditingTopicField(null)}
        autoFocus
      >
        <option value="Low">Low</option>
        <option value="Normal">Normal</option>
        <option value="High">High</option>
        <option value="Urgent">Urgent</option>
      </select>
    ) : (
      <strong>{selectedTopic.priority || "Normal"}</strong>
    )}
  </button>

  <button
    type="button"
    className={`workspace_topic_info_item deadline ${
      canManageTopics ? "editable" : "read_only"
    }`}
    onClick={() => canManageTopics && setEditingTopicField("deadline")}
    disabled={!canManageTopics}
  >
    <span>
      <i className="ti-calendar"></i>
      Deadline
    </span>

    {canManageTopics && editingTopicField === "deadline" ? (
      <div
        className="workspace_topic_deadline_editor"
        onClick={(e) => e.stopPropagation()}
      >
        <select
          value={selectedTopic.dateMode || "none"}
          onChange={(e) => handleUpdateTopicDeadlineMode(e.target.value)}
          autoFocus
        >
          <option value="none">No deadline</option>
          <option value="deadline">Has deadline</option>
        </select>

        {selectedTopic.dateMode === "deadline" && (
          <div className="workspace_topic_deadline_dates">
            <input
              type="date"
              value={selectedTopic.startDate || ""}
              onChange={(e) =>
                handleUpdateTopicDate("startDate", e.target.value)
              }
            />

            <input
              type="date"
              value={selectedTopic.endDate || ""}
              onChange={(e) =>
                handleUpdateTopicDate("endDate", e.target.value)
              }
            />
          </div>
        )}

        <button
          type="button"
          className="workspace_topic_done_btn"
          onClick={() => setEditingTopicField(null)}
        >
          Done
        </button>
      </div>
    ) : (
      <strong>{topicDeadlineText}</strong>
    )}
  </button>
</section>
        <form
          className="workspace_clickup_description"
          onSubmit={handleSaveTopicNote}
        >
          <textarea
            value={topicContent}
            onChange={(e) => setTopicContent(e.target.value)}
            placeholder="Add topic description, information, note, or wiki..."
            readOnly={!canManageTopics}
          />

          {canManageTopics ? (
            <div className="workspace_clickup_description_actions">
              <button type="submit">Save update</button>
            </div>
          ) : (
            <p className="workspace_permission_hint">
              Viewer mode: you can read topics and use the Message tab.
            </p>
          )}
        </form>

        <section className="workspace_clickup_section">
  <div className="workspace_clickup_subtask_header">
    <h2>Add subtask</h2>

    <div className="workspace_clickup_subtask_header_actions">
  <button type="button">
    <i className="ti-exchange-vertical"></i>
    Sort
  </button>

  <button type="button">
    <i className="ti-arrows-corner"></i>
  </button>
</div>
  </div>

  {canManageTopics ? (
  <form
    className={`workspace_clickup_subtask_form ${
      isSubtaskEditing ? "editing" : ""
    }`}
    onSubmit={handleAddTopicSubtask}
  >
    <div className="workspace_clickup_subtask_input_side">
      <span className="workspace_clickup_subtask_circle"></span>

      <input
        value={topicSubtaskInput}
        onFocus={() => setIsSubtaskEditing(true)}
        onChange={(e) => {
          setTopicSubtaskInput(e.target.value);
          setIsSubtaskEditing(true);
        }}
        placeholder="Add Task"
      />
    </div>

    {isSubtaskEditing && (
      <div className="workspace_clickup_subtask_tools">
        <button type="button" title="Subtask type">
          <i className="ti-package"></i>
        </button>

        <button type="button" title="Magic">
          <i className="ti-wand"></i>
        </button>

        <button type="button" title="Assignee">
          <i className="ti-user"></i>
        </button>

        <div className="workspace_clickup_subtask_tool_wrap">
          <button
            type="button"
            title="Date"
            onClick={() => {
              setIsSubtaskDateOpen(!isSubtaskDateOpen);
              setIsSubtaskPriorityOpen(false);
            }}
          >
            <i className="ti-calendar"></i>
          </button>

{isSubtaskDateOpen && (
  <div className="workspace_clickup_subtask_date_panel">
    <div className="workspace_clickup_deadline_options">
      <button
        type="button"
        className={subtaskDateMode === "none" ? "active" : ""}
        onClick={() => {
          setSubtaskDateMode("none");
          setSubtaskStartDate("");
          setSubtaskEndDate("");
        }}
      >
        <i className="ti-close"></i>
        No deadline
      </button>

      <button
        type="button"
        className={subtaskDateMode === "deadline" ? "active" : ""}
        onClick={() => setSubtaskDateMode("deadline")}
      >
        <i className="ti-calendar"></i>
        Set deadline
      </button>
    </div>

    {subtaskDateMode === "deadline" && (
      <div className="workspace_clickup_date_inputs">
        <label>
          <span>Start date</span>
          <input
            type="date"
            value={subtaskStartDate}
            onChange={(e) => setSubtaskStartDate(e.target.value)}
          />
        </label>

        <label>
          <span>End date</span>
          <input
            type="date"
            value={subtaskEndDate}
            min={subtaskStartDate}
            onChange={(e) => setSubtaskEndDate(e.target.value)}
          />
        </label>
      </div>
    )}

    <div className="workspace_clickup_date_footer">
      <button
        type="button"
        onClick={() => {
          setSubtaskDateMode("none");
          setSubtaskStartDate("");
          setSubtaskEndDate("");
          setIsSubtaskDateOpen(false);
        }}
      >
        Clear
      </button>

      <button
        type="button"
        onClick={() => setIsSubtaskDateOpen(false)}
      >
        Apply
      </button>
    </div>
  </div>
)}
        </div>

        <div className="workspace_clickup_subtask_tool_wrap">
          <button
            type="button"
            title="Priority"
            onClick={() => {
              setIsSubtaskPriorityOpen(!isSubtaskPriorityOpen);
              setIsSubtaskDateOpen(false);
            }}
          >
            <i className="ti-flag-alt"></i>
          </button>

          {isSubtaskPriorityOpen && (
            <div className="workspace_clickup_subtask_menu priority_menu">
              <strong>Priority</strong>

              {["Urgent", "High", "Normal", "Low"].map((priorityOption) => (
                <button
                  type="button"
                  key={priorityOption}
                  onClick={() => {
                    setSubtaskPriority(priorityOption);
                    setIsSubtaskPriorityOpen(false);
                  }}
                >
                  <span>{getSubtaskPriorityIcon(priorityOption)}</span>
                  {priorityOption}
                </button>
              ))}

              <button
                type="button"
                onClick={() => {
                  setSubtaskPriority("");
                  setIsSubtaskPriorityOpen(false);
                }}
              >
                <span>⊘</span>
                Clear
              </button>
            </div>
          )}
        </div>

        <button type="button" title="Tag">
          <i className="ti-tag"></i>
        </button>

        <button type="button" title="Link">
          <i className="ti-link"></i>
        </button>

        <button
          type="button"
          className="workspace_clickup_subtask_cancel"
          onClick={handleCancelSubtask}
        >
          Cancel
        </button>

        <button type="submit" className="workspace_clickup_subtask_save">
          Save ↵
        </button>
      </div>
    )}
  </form>
  ) : (
    <p className="workspace_permission_hint">
      Only editors and admins can add or update subtasks.
    </p>
  )}

  {subtasks.length > 0 && (
    <div className="workspace_clickup_subtask_list">
      {subtasks.map((subtask) => (
        <article
          className={`workspace_clickup_subtask_item ${
            subtask.isDone ? "completed" : ""
          }`}
          key={subtask.id}
        >
          <button
            type="button"
            className="workspace_clickup_subtask_check"
            onClick={() => handleToggleSubtask(subtask.id)}
            disabled={!canManageTopics}
          >
            {subtask.isDone ? <i className="ti-check"></i> : null}
          </button>

          <div className="workspace_clickup_subtask_info">
            <strong>{subtask.title}</strong>

            <div>
              {subtask.priority && (
                <span>
                  {getSubtaskPriorityIcon(subtask.priority)} {subtask.priority}
                </span>
              )}

{subtask.dateMode === "deadline" && (
  <span>
    <i className="ti-calendar"></i>
    {subtask.startDate || "No start"} → {subtask.endDate || "No end"}
  </span>
)}

{subtask.dateMode !== "deadline" && (
  <span>
    <i className="ti-close"></i>
    No deadline
  </span>
)}

              <span>
                <i className="ti-user"></i>
                {subtask.assignee || profileName}
              </span>
            </div>
          </div>

          {canManageTopics && (
            <button
              type="button"
              className="workspace_clickup_subtask_delete"
              onClick={() => handleDeleteSubtask(subtask.id)}
            >
              <i className="ti-trash"></i>
            </button>
          )}
        </article>
      ))}
    </div>
  )}
</section>
  <section className="workspace_clickup_attachment_section">
  <div className="workspace_clickup_attachment_header">
    <div>
      <h2>Attachments</h2>
      <span>{relatedFiles.length}</span>
    </div>

    <div className="workspace_clickup_attachment_tools">
      <button type="button" title="Download">
        <i className="ti-download"></i>
      </button>

      <button type="button" className="active" title="Grid view">
        <i className="ti-layout-grid2"></i>
      </button>

      <button type="button" title="List view">
        <i className="ti-menu-alt"></i>
      </button>

      {canManageTopics && (
        <label title="Upload file">
          <i className="ti-plus"></i>
          <input type="file" multiple onChange={handleTopicFileChange} />
        </label>
      )}
    </div>
  </div>

  {canManageTopics ? (
    <label className="workspace_clickup_drop_zone">
      Drop your files here to <span>upload</span>
      <input type="file" multiple onChange={handleTopicFileChange} />
    </label>
  ) : (
    <p className="workspace_permission_hint">
      Only editors and admins can upload attachments to topics.
    </p>
  )}

  {relatedFiles.length === 0 ? (
    <div className="workspace_clickup_attachment_empty">
      <i className="ti-clip"></i>
      <h3>No attachments yet</h3>
      <p>Upload files related to this topic so members can review them.</p>
    </div>
  ) : (
    <div className="workspace_clickup_attachment_grid">
      {relatedFiles.map((file) => (
        <article className="workspace_clickup_attachment_card" key={file.id}>
          <div className="workspace_clickup_attachment_preview">
            <i className="ti-clip"></i>
          </div>

          <div className="workspace_clickup_attachment_info">
            <div>
              <strong>{file.fileName || file.name}</strong>
              <span>
                {file.createdAt
                  ? new Date(file.createdAt).toLocaleDateString()
                  : "Just now"}
              </span>
            </div>

<div className="workspace_clickup_attachment_actions">
  <span className="workspace_clickup_attachment_owner">
    {profileName.slice(0, 1).toUpperCase()}
  </span>

  {canManageTopics && (
    <button
      type="button"
      className="workspace_clickup_attachment_delete"
      onClick={() => handleDeleteTopicFile(file.id)}
      title="Delete file"
    >
      <i className="ti-trash"></i>
    </button>
  )}
</div>
          </div>
        </article>
      ))}
    </div>
  )}
</section>
      </main>

      <aside className="workspace_clickup_activity">
        <header>
          <h2>Activity</h2>
        </header>

        <section className="workspace_clickup_activity_body">
          {comments.length === 0 ? (
            <div className="workspace_clickup_activity_empty">
              <i className="ti-comments"></i>
              <p>No activity yet.</p>
            </div>
          ) : (
            comments.map((comment) => {
              const authorName = comment.author?.name || comment.author || "Member";
              const authorMatchesCurrentUser = [
                comment.author?.email,
                comment.author?.username,
                comment.author?.fullName,
                authorName,
              ]
                .map(normalizeIdentity)
                .some(
                  (identity) =>
                    identity && currentUserIdentifiers.includes(identity),
                );
              const isOwnComment =
                (currentUserId && String(comment.userId) === currentUserId) ||
                authorMatchesCurrentUser;

              return (
                <article
                  className={`workspace_clickup_comment ${
                    isOwnComment ? "is_own" : "is_other"
                  }`}
                  key={comment.id}
                >
                  {!isOwnComment && (
                    <div className="workspace_clickup_comment_avatar">
                      {authorName.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="workspace_clickup_comment_content">
                    <strong>{isOwnComment ? "You" : authorName}</strong>
                    <p>{comment.content}</p>
                    <time dateTime={comment.createdAt || undefined}>
                      {comment.createdAt
                        ? new Date(comment.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Just now"}
                      {isOwnComment ? " · Sent" : " · Received"}
                    </time>
                  </div>
                </article>
              );
            })
          )}
        </section>

        {selectedTopic ? (
          <form
            className="workspace_clickup_comment_form"
            onSubmit={handleAddTopicComment}
          >
            <textarea
              value={topicCommentInput}
              onChange={(e) => setTopicCommentInput(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Type your message..."
            />

            <div className="workspace_clickup_comment_actions">
              <button
                type="button"
                className="workspace_clickup_comment_more"
                aria-label="More message options"
                aria-expanded={Boolean(commentComposerMenu)}
                onClick={() =>
                  setCommentComposerMenu((currentMenu) =>
                    currentMenu ? null : "more",
                  )
                }
              >
                ...
              </button>

              {commentComposerMenu && (
                <div className="workspace_comment_composer_menu">
                  {commentComposerMenu === "more" ? (
                    <>
                      <label
                        title="Upload a file to this topic chat"
                      >
                        <i className="ti-clip"></i>
                        Send file
                        <input
                          type="file"
                          multiple
                          onChange={(event) => {
                            setCommentComposerMenu(null);
                            handleTopicChatFileChange(event);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setCommentComposerMenu("mention")}
                      >
                        <i className="ti-user"></i>
                        @Mention
                        <i className="ti-angle-right"></i>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="workspace_comment_menu_back"
                        onClick={() => setCommentComposerMenu("more")}
                      >
                        <i className="ti-angle-left"></i>
                        Mention someone
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInsertTopicMention("everyone")}
                      >
                        <span className="workspace_comment_mention_avatar">@</span>
                        Everyone
                      </button>

                      {visibleWorkspaceMembers.map((member) => (
                        <button
                          type="button"
                          key={member.id || member.email || member.name}
                          onClick={() => handleInsertTopicMention(member.name)}
                        >
                          <span className="workspace_comment_mention_avatar">
                            {member.name.slice(0, 1).toUpperCase()}
                          </span>
                          {member.name}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="workspace_clickup_comment_send"
                aria-label="Send message"
                disabled={!topicCommentInput.trim()}
              >
                <i className="ti-control-play"></i>
              </button>
            </div>
          </form>
        ) : (
          null
        )}
      </aside>
    </section>
  );
}

    return (
      <section className="discussion_tab_page">
        <div className="discussion_intro_row">
          <div>
            <span className="discussion_label">Student discussion</span>
            <h2>Discussion Board</h2>
            <p>
              Ask questions, share learning materials, and discuss lessons with
              members in this workspace.
            </p>
          </div>

          {canManageTopics ? (
            <button
              type="button"
              className="new_discussion_topic_btn"
              onClick={() => setIsTopicFormOpen(true)}
            >
              <i className="ti-plus"></i>
              New Topic
            </button>
          ) : (
            <span className="workspace_permission_pill">
              <i className="ti-eye"></i>
              Viewer mode
            </span>
          )}
        </div>

        <div className="discussion_filter_row">
  <button
    type="button"
    className={topicFilter === "All" ? "active" : ""}
    onClick={() => setTopicFilter("All")}
  >
    All topics
  </button>

  <button
    type="button"
    className={topicFilter === "Solved" ? "active" : ""}
    onClick={() => setTopicFilter("Solved")}
  >
    Solved
  </button>
</div>
        {(isLoadingDiscussion || discussionStatus) && (
          <div className="workspace_permission_hint">
            {isLoadingDiscussion ? "Loading discussion topics..." : discussionStatus}
          </div>
        )}
        {isTopicFormOpen && canManageTopics && (
          <div className="discussion_topic_modal_overlay">
            <form
              className="discussion_create_card discussion_topic_modal_card"
              onSubmit={handleCreateTopic}
            >
              <button
                type="button"
                className="discussion_topic_modal_close"
                onClick={() => setIsTopicFormOpen(false)}
                aria-label="Close create topic popup"
              >
                ×
              </button>

              <div className="discussion_create_header">
                <div className="discussion_creator_avatar">
                  {profileName.slice(0, 2).toUpperCase()}
                </div>

                <div>
                  <h3>Create new topic</h3>
                  <p>Started by {profileName}</p>
                </div>
              </div>

              <div className="discussion_form_group">
  <label>Topic title</label>
  <input
    value={topicTitle}
    onChange={(e) => setTopicTitle(e.target.value)}
    placeholder="Example: Why does this constraint use >= ?"
    autoFocus
  />
</div>

<div className="discussion_form_group">
  <label>Topic description</label>
  <textarea
    value={newTopicDescription}
    onChange={(e) => setNewTopicDescription(e.target.value)}
    placeholder="Describe the problem, lesson note, question, or material you want members to discuss..."
  />
</div>

<div className="discussion_topic_form_grid">
  <div className="discussion_form_group">
    <label>Priority</label>
    <select
      value={newTopicPriority}
      onChange={(e) => setNewTopicPriority(e.target.value)}
    >
      <option value="Low">Low</option>
      <option value="Normal">Normal</option>
      <option value="High">High</option>
      <option value="Urgent">Urgent</option>
    </select>
  </div>

  <div className="discussion_form_group">
    <label>Deadline option</label>
    <select
      value={newTopicDateMode}
      onChange={(e) => {
        setNewTopicDateMode(e.target.value);

        if (e.target.value === "none") {
          setNewTopicStartDate("");
          setNewTopicEndDate("");
        }
      }}
    >
      <option value="none">No deadline</option>
      <option value="deadline">Set deadline</option>
    </select>
  </div>
</div>

{newTopicDateMode === "deadline" && (
  <div className="discussion_topic_form_grid">
    <div className="discussion_form_group">
      <label>Start date</label>
      <input
        type="date"
        value={newTopicStartDate}
        onChange={(e) => setNewTopicStartDate(e.target.value)}
      />
    </div>

    <div className="discussion_form_group">
      <label>End date</label>
      <input
        type="date"
        value={newTopicEndDate}
        min={newTopicStartDate}
        onChange={(e) => setNewTopicEndDate(e.target.value)}
      />
    </div>
  </div>
)}

              <div className="discussion_create_actions">
                <button type="button" onClick={() => setIsTopicFormOpen(false)}>
                  Cancel
                </button>

                <button type="submit">Create topic</button>
              </div>
            </form>
          </div>
        )}

        <section className="discussion_content_grid">
          <div className="discussion_content_left">
            {discussionTopics.length === 0 && !isTopicFormOpen ? (
              <section className="discussion_empty_state">
                <div className="discussion_empty_icon">
                  <i className="ti-comments"></i>
                </div>

                <h3>No discussion topic yet</h3>
                <p>
                  Start the first topic so members can ask questions, share notes,
                  and exchange study materials.
                </p>
                {canManageTopics ? (
                  <button type="button" onClick={() => setIsTopicFormOpen(true)}>
                    Create first topic
                  </button>
                ) : (
                  <span className="workspace_permission_pill">
                    Editors and admins can create topics
                  </span>
                )}
              </section>
            ) : null}

            {filteredDiscussionTopics.length > 0 && (
              <>
                <section className="discussion_topic_list">
                  {filteredDiscussionTopics.map((topic) => (
                    <article
                      className="discussion_topic_card"
                      key={topic.id}
                      onClick={() => {
  setSelectedTopicId(topic.id);
  setTopicContent(topic.content || "");
  setTopicCommentInput("");
  setTopicSubtaskInput("");
}}
                    >
                      <div className="discussion_topic_type">
                        <span>{topic.type || "Question"}</span>
                        <small>{topic.updatedAt}</small>
                      </div>

                      <h3>{topic.title}</h3>
                      <p>
                        Started by {topic.creator}. Open this topic to reply,
                        add study notes, and attach learning files.
                      </p>

                      <div className="discussion_topic_meta">
                        <span>
                          <i className="ti-comment-alt"></i>
                          {topic.comments?.length || 0} replies
                        </span>

                        <span>
                          <i className="ti-clip"></i>
                          {topic.files?.length || 0} files
                        </span>

<span>
  <i className="ti-check"></i>
  {topic.status || "Open"}
</span>
                      </div>
                    </article>
                  ))}
                </section>
                {discussionTopics.length > 0 && filteredDiscussionTopics.length === 0 && (
  <section className="discussion_empty_state">
    <div className="discussion_empty_icon">
      <i className="ti-filter"></i>
    </div>

    <h3>No matching topics</h3>
    <p>
      There are no topics matching this filter. Try another topic type or
      create a new one.
    </p>

    <button type="button" onClick={() => setTopicFilter("All")}>
      Show all topics
    </button>
  </section>
)}
              </>
            )}
          </div>

          <aside className="discussion_content_sidebar">
            <section className="discussion_side_card">
              <div className="discussion_side_title">
                <h3>Discussion overview</h3>
                <i className="ti-comments"></i>
              </div>

              <div className="discussion_stats_grid">
                <div>
                  <strong>{discussionTopics.length}</strong>
                  <span>Topics</span>
                </div>

                <div>
                  <strong>{totalTopicFiles}</strong>
                  <span>Files</span>
                </div>
              </div>
            </section>

            <section className="workspace_storage_card">
              <div className="workspace_storage_header">
                <div className="workspace_storage_icon">
                  <i className="ti-harddrives"></i>
                </div>

                <div>
                  <h3>Workspace Storage</h3>
                  <p>Storage used by files uploaded in discussion topics</p>
                </div>
              </div>

              <div className="workspace_storage_limit_row">
                <strong>Storage limit</strong>
                <span>
                  {formatWorkspaceStorageSize(workspaceStorageUsedBytes)} / 50.0
                  MB
                </span>
              </div>

              <div className="workspace_storage_progress">
                <div style={{ width: `${workspaceStoragePercent}%` }}></div>
              </div>

              <div className="workspace_storage_numbers">
                <div>
                  <strong>
                    {formatWorkspaceStorageSize(workspaceStorageUsedBytes)}
                  </strong>
                  <span>Used</span>
                </div>

                <div>
                  <strong>
                    {formatWorkspaceStorageSize(workspaceStorageRemainingBytes)}
                  </strong>
                  <span>Remaining</span>
                </div>
              </div>
            </section>

            <section className="discussion_side_card">
              <div className="discussion_side_title">
                <h3>Topic guide</h3>
                <i className="ti-light-bulb"></i>
              </div>

              <ul className="discussion_guide_list">
                <li>
                  Use Question when you need help with a lesson or exercise.
                </li>
                <li>
                  Use Material when you share notes, slides, or documents.
                </li>
                <li>
                  Use Announcement for deadlines, schedules, or group updates.
                </li>
              </ul>
            </section>

            <section className="workspace_about_card">
              <div className="workspace_about_header">
                <i className="ti-bookmark-alt"></i>
                <h3>About this workspace</h3>
              </div>

              <p>
                {workspace?.description ||
                  "This workspace helps students discuss lessons, share documents, and collaborate with selected members."}
              </p>
            </section>
          </aside>
        </section>
      </section>
    );
  }

  function renderStudyTab() {
    const hasStudyCards = Boolean(selectedStudySet && currentStudyCard);

    return (
      <section className="workspace_study_tab">
        <aside className="workspace_study_sidebar">
          <div className="workspace_study_sidebar_header">
            <h3>Flashcard Sets</h3>

            <button type="button" aria-label="Open flashcard library">
              <i className="ti-layout-grid2"></i>
            </button>
          </div>

          <button
            type="button"
            className="workspace_study_generate_btn"
            onClick={handleGenerateWorkspaceFlashcards}
            disabled={isGeneratingStudyCards || !selectedStudyDocumentId}
          >
            <i className="ti-plus"></i>
            {isGeneratingStudyCards ? "Generating..." : "Generate New"}
          </button>

          <label className="workspace_study_document_picker">
            <span>Approved document</span>
            <select
              value={selectedStudyDocumentId}
              onChange={(event) =>
                setSelectedStudyDocumentId(event.target.value)
              }
              disabled={
                isGeneratingStudyCards || approvedWorkspaceDocuments.length === 0
              }
            >
              {approvedWorkspaceDocuments.length === 0 && (
                <option value="">No approved workspace documents</option>
              )}

              {approvedWorkspaceDocuments.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>

          <div className="workspace_study_set_list">
            {isLoadingStudySets && (
              <p className="workspace_empty_text">Loading flashcards...</p>
            )}

            {!isLoadingStudySets && studySets.length === 0 && (
              <p className="workspace_empty_text">
                No generated flashcards found for this workspace.
              </p>
            )}

            {!isLoadingStudySets && studySets.map((studySet) => (
              <button
                type="button"
                className={`workspace_study_set_card ${
                  selectedStudySetId === studySet.id ? "active" : ""
                }`}
                key={studySet.id}
                onClick={() => handleSelectStudySet(studySet.id)}
              >
                {studySet.tag && (
                  <strong>
                    <i className="ti-medall"></i>
                    {studySet.tag}
                  </strong>
                )}

                <span>{studySet.title}</span>
                <small>{studySet.meta}</small>
              </button>
            ))}
          </div>

          <section className="workspace_study_ai_card">
            <div>
              <i className="ti-target"></i>
            </div>

            <section>
              <strong>Flashcards</strong>
              <p>
                {studySetStatus ||
                  `${workspaceFlashcards.length} saved workspace cards`}
              </p>
            </section>
          </section>
        </aside>

        <section className="workspace_study_main">
          <header className="workspace_study_header">
            <div>
              <h2>{selectedStudySet?.title || "No flashcards yet"}</h2>
              <p>
                {selectedStudySet?.subtitle ||
                  "Generate flashcards from an approved workspace document to study here."}
              </p>
            </div>

            <div className="workspace_study_progress">
              <div>
                <span
                  style={{
                    width: `${
                      hasStudyCards
                        ? ((currentStudyCardIndex + 1) /
                            selectedStudySet.cards.length) *
                          100
                        : 0
                    }%`,
                  }}
                ></span>
              </div>

              <p>
                <strong>Session Progress</strong>
                {hasStudyCards ? currentStudyCardIndex + 1 : 0} of{" "}
                {selectedStudySet?.cards?.length || 0}{" "}
                cards
              </p>
            </div>
          </header>

          <section className="workspace_study_stage">
            <button
              type="button"
              className={`workspace_flashcard ${
                isStudyCardFlipped ? "flipped" : ""
              }`}
              onClick={() =>
                hasStudyCards && setIsStudyCardFlipped(!isStudyCardFlipped)
              }
            >
              <span>{isStudyCardFlipped ? "Answer" : "Question"}</span>

              <h3>
                {!hasStudyCards
                  ? "No flashcards are available for this workspace yet."
                  : isStudyCardFlipped
                  ? currentStudyCard.answer
                  : currentStudyCard.question}
              </h3>

              <small>
                <i className="ti-mouse"></i>
                Click to flip
              </small>
            </button>

            <div className="workspace_study_controls">
              <button
                type="button"
                onClick={handlePreviousStudyCard}
                disabled={!hasStudyCards}
              >
                <i className="ti-arrow-left"></i>
              </button>

              <button
                type="button"
                className="workspace_study_flip_btn"
                onClick={() =>
                  hasStudyCards && setIsStudyCardFlipped(!isStudyCardFlipped)
                }
                disabled={!hasStudyCards}
              >
                <i className="ti-reload"></i>
                Flip Card
              </button>

              <button
                type="button"
                onClick={handleNextStudyCard}
                disabled={!hasStudyCards}
              >
                <i className="ti-arrow-right"></i>
              </button>
            </div>
          </section>

          <section className="workspace_study_stats">
            <article>
              <div className="workspace_study_stat_icon">
                <i className="ti-timer"></i>
              </div>

              <section>
                <span>Time Spent</span>
                <strong>{formatStudySessionDuration(studySessionSeconds)}</strong>
                <p>This session</p>
              </section>
            </article>

            <article>
              <div className="workspace_study_stat_icon highlight">
                <i className="ti-bolt"></i>
              </div>

              <section>
                <span>Cards Reviewed</span>
                <strong>
                  {reviewedStudyCardIds.length}/{selectedStudySet?.cards?.length || 0}
                </strong>
                <p>Unique cards opened</p>
              </section>
            </article>

            <article>
              <div className="workspace_study_stat_icon">
                <i className="ti-headphone-alt"></i>
              </div>

              <section>
                <span>Current Card</span>
                <strong>
                  {hasStudyCards ? currentStudyCardIndex + 1 : 0}
                </strong>
                <p>{selectedStudySet?.cards?.length || 0} cards in this set</p>
              </section>
            </article>
          </section>
        </section>
      </section>
    );
  }

  function renderDocumentsTab() {
    return (
      <section className="workspace_documents_tab">
        <header className="workspace_documents_header">
          <div>
            <span>Workspace Files</span>
            <h2>Documents</h2>
            <p>Upload learning materials to this workspace and use approved files for AI study cards.</p>
          </div>

          <div className="workspace_documents_count">
            <strong>{workspaceDocuments.length}</strong>
            <span>Files</span>
          </div>
        </header>

        <section className="workspace_documents_upload_card">
          <div className="workspace_documents_upload_copy">
            <div className="workspace_documents_upload_icon">
              <i className="ti-upload"></i>
            </div>

            <div>
              <h3>Upload workspace documents</h3>
              <p>PDF, DOCX, and TXT files are supported. Files are checked before becoming available for study tools.</p>
            </div>
          </div>

          <div className="workspace_documents_upload_actions">
            <label className="workspace_documents_file_picker">
              <i className="ti-folder"></i>
              <span>
                {workspaceUploadFiles.length > 0
                  ? `${workspaceUploadFiles.length} selected`
                  : "Choose files"}
              </span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt"
                onChange={handleWorkspaceDocumentFileChange}
                disabled={isUploadingWorkspaceDocuments}
              />
            </label>

            <button
              type="button"
              onClick={handleUploadWorkspaceDocuments}
              disabled={
                isUploadingWorkspaceDocuments ||
                workspaceUploadFiles.length === 0
              }
            >
              {isUploadingWorkspaceDocuments ? "Uploading..." : "Upload"}
            </button>
          </div>

          {workspaceUploadFiles.length > 0 && (
            <div className="workspace_documents_selected_files">
              {workspaceUploadFiles.map((file) => (
                <span key={`${file.name}-${file.size}`}>
                  {file.name} · {formatWorkspaceFileSize(file.size)}
                </span>
              ))}
            </div>
          )}

          {workspaceDocumentStatus && (
            <p className="workspace_documents_status">
              {workspaceDocumentStatus}
            </p>
          )}
        </section>

        <section className="workspace_documents_list_card">
          <div className="workspace_documents_list_header">
            <h3>Workspace document list</h3>
            <span>{approvedWorkspaceDocuments.length} approved</span>
          </div>

          {workspaceDocuments.length === 0 ? (
            <div className="workspace_documents_empty">
              <i className="ti-files"></i>
              <h3>No workspace documents yet</h3>
              <p>Upload a document here, then use approved documents in the Study tab.</p>
            </div>
          ) : (
            <div className="workspace_documents_list">
              {workspaceDocuments.map((document) => {
                const status = String(document.status || "PENDING").toUpperCase();
                const isApproved = status === "APPROVED";
                const needsWorkspaceReview =
                  canManageWorkspace &&
                  ["PENDING", "FLAGGED", "PENDING_RETRY", "REJECTED"].includes(
                    status,
                  );

                return (
                  <article className="workspace_document_row" key={document.id}>
                    <div className="workspace_document_icon">
                      <i className="ti-file"></i>
                    </div>

                    <div className="workspace_document_info">
                      <h3>{document.title}</h3>
                      <p>
                        {formatWorkspaceFileSize(document.file_size_bytes)} ·{" "}
                        {document.created_at
                          ? new Date(document.created_at).toLocaleDateString()
                          : "Recently uploaded"}
                      </p>
                    </div>

                    <span
                      className={`workspace_document_status ${status.toLowerCase()}`}
                    >
                      {getDocumentStatusLabel(status)}
                    </span>

                    <div className="workspace_document_actions">
                      {needsWorkspaceReview && (
                        <>
                          <button
                            type="button"
                            className="approve"
                            onClick={() =>
                              handleReviewWorkspaceDocument(document.id, "APPROVE")
                            }
                          >
                            Approve
                          </button>

                          <button
                            type="button"
                            className="reject"
                            onClick={() =>
                              handleReviewWorkspaceDocument(document.id, "REJECT")
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {(canManageWorkspace ||
                        String(document.uploaderId || "") === currentUserId) && (
                        <button
                          type="button"
                          className="delete"
                          disabled={deletingWorkspaceDocumentId === document.id}
                          onClick={() => handleDeleteWorkspaceDocument(document)}
                        >
                          <i className="ti-trash"></i>
                          {deletingWorkspaceDocumentId === document.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      )}

                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderSettingsTab() {
    if (!canManageWorkspace) {
      return (
        <section className="workspace_permission_empty">
          <i className="ti-lock"></i>
          <h2>Admin access only</h2>
          <p>Only workspace admins can change workspace settings.</p>
        </section>
      );
    }

    return (
      <section className="workspace_settings_tab">
        <header className="workspace_settings_header">
          <div>
            <span>Workspace Settings</span>
            <h2>Manage workspace</h2>
            <p>Update this workspace name or delete this workspace.</p>
          </div>
        </header>

        <section className="workspace_settings_card">
          <div className="workspace_settings_card_header">
            <div className="workspace_settings_icon">
              <i className="ti-pencil-alt"></i>
            </div>

            <div>
              <h3>Rename workspace</h3>
              <p>Change the display name of this workspace.</p>
            </div>
          </div>

          <form
            className="workspace_settings_form"
            onSubmit={handleRenameWorkspace}
          >
            <label>Workspace name</label>
            <input
              type="text"
              value={workspaceNameInput}
              onChange={handleWorkspaceNameChange}
              placeholder="Enter workspace name"
            />

            <small
              className={
                workspaceNameInput.length > WORKSPACE_NAME_MAX_LENGTH
                  ? "settings_warning_text"
                  : ""
              }
            >
              {workspaceNameInput.length}/{WORKSPACE_NAME_MAX_LENGTH} characters
            </small>
            <button type="submit">Save changes</button>
          </form>

          {workspaceSettingMessage && (
            <p className="workspace_settings_message">
              {workspaceSettingMessage}
            </p>
          )}
        </section>

        <section className="workspace_settings_card danger">
          <div className="workspace_settings_card_header">
            <div className="workspace_settings_icon danger">
              <i className="ti-trash"></i>
            </div>

            <div>
              <h3>Delete workspace</h3>
              <p>Remove this workspace for all members.</p>
            </div>
          </div>

          <button
            type="button"
            className="workspace_delete_btn"
            onClick={handleDeleteWorkspace}
          >
            Delete workspace
          </button>
        </section>
      </section>
    );
  }

  function renderInviteMemberModal() {
    if (!isInviteModalOpen) return null;

    return (
      <div className="workspace_invite_overlay">
        <section className="workspace_invite_modal">
          <header className="workspace_invite_header">
            <div className="workspace_invite_header_icon">
              <i className="ti-user"></i>
            </div>

            <div>
              <h2>Invite Members</h2>
              <p>Add collaborators to your academic hub</p>
            </div>

            <button type="button" onClick={handleCloseInviteModal}>
              ×
            </button>
          </header>

          <div className="workspace_invite_field">
            <label>Find by username or full name</label>

            <div className="workspace_invite_search">
              <i className="ti-search"></i>
              <input
                type="text"
                value={inviteQuery}
                onChange={handleInviteQueryChange}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearchInviteMember();
                  }
                }}
                placeholder="Username, full name or email"
                autoFocus
              />
            </div>
            {inviteError && (
              <p className="workspace_invite_error" role="alert">
                <i className="ti-alert" />
                {inviteError}
              </p>
            )}
          </div>

          <div className="workspace_invite_result_title">
            SEARCH RESULTS {inviteStatus === "found" ? `(${candidateUsers.length})` : ""}
          </div>

          {inviteStatus === "found" && (
            <section className="workspace_invite_result">
              {candidateUsers.map((user) => (
                <label
                  className={`workspace_invite_candidate ${
                    selectedUserId === user.id ? "is-selected" : ""
                  } ${user.isWorkspaceMember ? "is-existing-member" : ""}`}
                  key={user.id}
                >
                  <input
                    type="radio"
                    name="workspace-user"
                    checked={selectedUserId === user.id}
                    disabled={user.isWorkspaceMember}
                    onChange={() => setSelectedUserId(user.id)}
                  />

                  <div className="workspace_invite_avatar">
                    <i className="ti-user"></i>
                  </div>

                  <div>
                    <h3>
                      {user.full_name || user.username || "Unnamed user"}
                      {user.isWorkspaceMember && (
                        <span className="workspace_invite_existing_badge">
                          Already in workspace
                        </span>
                      )}
                    </h3>
                    <p>
                      {user.username ? `@${user.username}` : user.email}
                    </p>
                    {user.isWorkspaceMember && (
                      <p className="workspace_invite_existing_note">
                        This user is already a member of this workspace.
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </section>
          )}

          {isInviteSearching && (
            <section className="workspace_invite_empty_result">
              <i className="ti-reload workspace_invite_spinner"></i>
              <p>Searching users...</p>
            </section>
          )}

          {inviteStatus === "idle" && !isInviteSearching && (
            <section className="workspace_invite_empty_result">
              <i className="ti-search"></i>
              <p>Enter a username, full name or email, then press Enter.</p>
            </section>
          )}

          {inviteStatus === "error" && !isInviteSearching && (
            <section className="workspace_invite_no_result">
              <div className="workspace_invite_no_result_icon">
                <i className="ti-alert"></i>
              </div>

              <h3>Cannot search users</h3>
              <p>{inviteError}</p>

              <div className="workspace_invite_no_result_actions">
                <button
                  type="button"
                  onClick={() => {
                    setInviteStatus("idle");
                    setInviteError("");
                  }}
                >
                  Try Again
                </button>
              </div>
            </section>
          )}

          {inviteStatus === "not-found" && !isInviteSearching && (
            <section className="workspace_invite_no_result">
              <div className="workspace_invite_no_result_icon">
                <i className="ti-search"></i>
              </div>

              <h3>No user found</h3>
              <p>
                We couldn't find any student or researcher matching "
                {inviteQuery}".
              </p>

              <div className="workspace_invite_no_result_actions">
                <button type="button" onClick={() => setInviteStatus("idle")}>
                  Try Again
                </button>
              </div>
            </section>
          )}

          <section className="workspace_invite_permission">
            <p>
              <i className="ti-shield"></i>
              Select default permissions
            </p>

            <div className="workspace_invite_permission_buttons">
              <button
                type="button"
                className={inviteRole === "Viewer" ? "active" : ""}
                onClick={() => setInviteRole("Viewer")}
              >
                <i className="ti-eye"></i>
                Viewer
              </button>

              <button
                type="button"
                className={inviteRole === "Editor" ? "active" : ""}
                onClick={() => setInviteRole("Editor")}
              >
                <i className="ti-pencil-alt"></i>
                Editor
              </button>
            </div>
          </section>

          <footer className="workspace_invite_footer">
            <span>
              <i className="ti-info-alt"></i>
              Invites expire in 7 days.
            </span>

            <div>
              <button type="button" onClick={handleCloseInviteModal}>
                Cancel
              </button>

              <button
                type="button"
                className="workspace_send_invite_btn"
                disabled={
                  isInviteSearching ||
                  isAddingMember ||
                  inviteQuery.trim().replace(/^@+/, "").length < 2 ||
                  (inviteStatus === "found" && !selectedUserId)
                }
                onClick={
                  inviteStatus === "found"
                    ? handleSendInvite
                    : handleSearchInviteMember
                }
              >
                {isInviteSearching
                  ? "Searching..."
                  : isAddingMember
                    ? "Adding..."
                    : inviteStatus === "found"
                      ? "Add member"
                      : "Search"}
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <main className="workspace_page">
      <nav className="workspace_top_tabs">
        <button
          className={activeTab === "discussion" ? "active" : ""}
          onClick={() => setActiveTab("discussion")}
        >
          <i className="ti-comments"></i>
          Discussion
        </button>

        <button
          className={activeTab === "messages" ? "active" : ""}
          onClick={() => setActiveTab("messages")}
        >
          <i className="ti-comment-alt"></i>
          Message
        </button>

        <button
          className={activeTab === "documents" ? "active" : ""}
          onClick={() => setActiveTab("documents")}
        >
          <i className="ti-files"></i>
          Files
        </button>

        <button
          className={activeTab === "members" ? "active" : ""}
          onClick={() => setActiveTab("members")}
        >
          <i className="ti-user"></i>
          Member
        </button>

        <button
          className={activeTab === "settings" ? "active" : ""}
          onClick={() => setActiveTab("settings")}
        >
          <i className="ti-settings"></i>
          Setting
        </button>
      </nav>

      {activeTab === "messages" && renderMessagesTab()}

      {activeTab === "discussion" && renderDiscussionTab()}

      {activeTab === "documents" && renderDocumentsTab()}

      {activeTab === "members" && renderMembersTab()}

      {activeTab === "settings" && renderSettingsTab()}

      {renderInviteMemberModal()}
    </main>
  );
}

export default WorkSpacePage;
