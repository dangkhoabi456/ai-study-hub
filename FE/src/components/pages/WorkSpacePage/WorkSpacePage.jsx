import { Link, useLocation, useParams, useNavigate } from "react-router-dom";
import { createAppNotification } from "../../../utils/notificationStore.js";
import { useEffect, useMemo, useState } from "react";
import {
  addWorkspaceMember,
  getWorkspaceMembers,
  searchWorkspaceUsers,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from "../../../utils/workspaceApi";
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
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch (error) {
    console.error("Cannot read current user profile:", error);
    return null;
  }
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
const [newTopicType, setNewTopicType] = useState("Question");
const [newTopicStatus, setNewTopicStatus] = useState("Open");
const [newTopicPriority, setNewTopicPriority] = useState("Normal");
const [newTopicDateMode, setNewTopicDateMode] = useState("none");
const [newTopicStartDate, setNewTopicStartDate] = useState("");
const [newTopicEndDate, setNewTopicEndDate] = useState("");
  const [topicFiles, setTopicFiles] = useState([]);
  const [topicCommentInput, setTopicCommentInput] = useState("");
const [topicSubtaskInput, setTopicSubtaskInput] = useState("");
const [isSubtaskEditing, setIsSubtaskEditing] = useState(false);
const [subtaskPriority, setSubtaskPriority] = useState("");
const [subtaskDateMode, setSubtaskDateMode] = useState("none");
const [subtaskStartDate, setSubtaskStartDate] = useState("");
const [subtaskEndDate, setSubtaskEndDate] = useState("");
const [isSubtaskDateOpen, setIsSubtaskDateOpen] = useState(false);
const [isSubtaskPriorityOpen, setIsSubtaskPriorityOpen] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [topicFilter, setTopicFilter] = useState("All");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");
  const [inviteStatus, setInviteStatus] = useState("idle");
  const [inviteError, setInviteError] = useState("");
  const [isInviteSearching, setIsInviteSearching] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [backendMembers, setBackendMembers] = useState([]);
  const [candidateUsers, setCandidateUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
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
  const [pendingInvitations] = useState([
    {
      email: "alex.proctor@edu.com",
      invitedBy: "TrongBVD",
      time: "2 hours ago",
    },
    {
      email: "m.chen@research.io",
      invitedBy: "TrongBVD",
      time: "yesterday",
    },
  ]);

  const [messageText, setMessageText] = useState("");
  const [messageAttachment, setMessageAttachment] = useState(null);
  const [selectedStudySetId, setSelectedStudySetId] = useState(
    "software-architecture",
  );
  const [currentStudyCardIndex, setCurrentStudyCardIndex] = useState(0);
  const [isStudyCardFlipped, setIsStudyCardFlipped] = useState(false);

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

  useEffect(() => {
    if (!workspace?.id) return;

    const currentRecentWorkspaces = JSON.parse(
      localStorage.getItem("aiStudyHubRecentWorkspaces") || "[]",
    );

    const recentWorkspace = {
      id: workspace.id,
      name: workspace.name || "Untitled Workspace",
      documents: Number(workspace.documents) || 0,
      icon: workspace.icon || "ti-layout-grid2",
      visitedAt: Date.now(),
    };

    const nextRecentWorkspaces = [
      recentWorkspace,
      ...currentRecentWorkspaces.filter((item) => item.id !== workspace.id),
    ].slice(0, 3);

    localStorage.setItem(
      "aiStudyHubRecentWorkspaces",
      JSON.stringify(nextRecentWorkspaces),
    );
  }, [
    workspace?.id,
    workspace?.name,
    workspace?.description,
    workspace?.icon,
    workspace?.documents,
  ]);

  const [workspaceNameInput, setWorkspaceNameInput] = useState(
    workspace?.name || "",
  );
  const [workspaceSettingMessage, setWorkspaceSettingMessage] = useState("");

  const profileName =
    localStorage.getItem("aiStudyHubProfileName") ||
    workspace?.owner ||
    "dangkhoabi456";

  const storedUser = useMemo(() => getStoredUserProfile(), []);

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
    getWorkspaceMemberRole(currentWorkspaceMember) ||
      workspace?.currentUserRole ||
      workspace?.role ||
      workspace?.memberRole ||
      (isWorkspaceOwner || backendMembers.length === 0 ? "Admin" : "Viewer"),
  );

  const canManageTopics =
    currentWorkspaceRole === "editor" || currentWorkspaceRole === "admin";
  const canManageWorkspace = currentWorkspaceRole === "admin";

  const activeTabIsAllowed =
    activeTab === "discussion" ||
    activeTab === "messages" ||
    (activeTab === "study" && canManageTopics) ||
    ((activeTab === "members" || activeTab === "settings") &&
      canManageWorkspace);
  const visibleActiveTab = activeTabIsAllowed ? activeTab : "discussion";

  const [chatMessages, setChatMessages] = useState([
    {
      id: "msg-1",
      senderName: "Sarah Jenkins",
      avatar: "https://i.pravatar.cc/80?img=32",
      text: "Does anyone have the notes for yesterday's lecture on architectural patterns? I missed the last 20 minutes.",
      time: "10:42 AM",
      isOwn: false,
    },
    {
      id: "msg-2",
      senderName: profileName,
      text: "I have them here! I just finished digitizing the sketches of the microservices diagram we discussed.",
      time: "10:45 AM · Read",
      isOwn: true,
      file: {
        name: "Software_Arch_Notes.pdf",
        sizeLabel: "2.4 MB",
        isImage: false,
      },
    },
    {
      id: "msg-3",
      senderName: "David Chen",
      avatar: "https://i.pravatar.cc/80?img=13",
      text: "Found this great reference in the university archives for our project proposal.",
      time: "11:15 AM",
      isOwn: false,
      file: {
        name: "University archive",
        sizeLabel: "Image",
        isImage: true,
        previewUrl:
          "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=900&q=80",
      },
    },
  ]);

  const discussionTopicsStorageKey = `aiStudyHubWorkspaceIssues_${workspaceId}`;

  const initialDiscussionTopics = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem(discussionTopicsStorageKey) || "[]",
      );
    } catch (error) {
      console.error("Cannot read workspace topics:", error);
      return [];
    }
  }, [discussionTopicsStorageKey]);

  const [discussionTopics, setDiscussionTopics] = useState(
    initialDiscussionTopics,
  );

  

  const WORKSPACE_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

  const discussionStorageUsedBytes = discussionTopics.reduce((total, topic) => {
    const topicFileSize = (topic.files || []).reduce(
      (fileTotal, file) => fileTotal + (Number(file.size) || 0),
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

  const studySets = [
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

  const selectedStudySet =
    studySets.find((studySet) => studySet.id === selectedStudySetId) ||
    studySets[0];
  const currentStudyCard =
    selectedStudySet.cards[currentStudyCardIndex] || selectedStudySet.cards[0];

  function formatMessageFileSize(size) {
    if (!size) return "0 KB";

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getCurrentMessageTime() {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function saveDiscussionTopics(nextTopics) {
    localStorage.setItem(
      discussionTopicsStorageKey,
      JSON.stringify(nextTopics),
    );
    setDiscussionTopics(nextTopics);
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

  function handleCreateTopic(e) {
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

  const newTopic = {
    id: `topic-${Date.now()}`,
    title: topicTitle.trim(),
    creator: profileName,

    type: newTopicType,
    status: newTopicStatus,
    priority: newTopicPriority,

    dateMode: newTopicDateMode,
    startDate: newTopicDateMode === "deadline" ? newTopicStartDate : "",
    endDate: newTopicDateMode === "deadline" ? newTopicEndDate : "",

    assignee: profileName,
    content: newTopicDescription.trim(),
    files: [],
    comments: [],
    subtasks: [],
    tasks: [],
    createdAt: "Created just now",
    updatedAt: "Updated just now",
  };

  saveDiscussionTopics([newTopic, ...discussionTopics]);
  createAppNotification({
  category: "discussion",
  action: "newTopic",
  title: "New discussion topic",
  message: `${profileName} created topic "${newTopic.title}".`,
  icon: "ti-comments",
  link: `/dashboard/workspaces/${workspaceId}`,
});
  setSelectedTopicId(newTopic.id);

  setTopicTitle("");
  setTopicContent(newTopic.content);
  setTopicFiles([]);

  setNewTopicDescription("");
  setNewTopicType("Question");
  setNewTopicStatus("Open");
  setNewTopicPriority("Normal");
  setNewTopicDateMode("none");
  setNewTopicStartDate("");
  setNewTopicEndDate("");

  setIsTopicFormOpen(false);
}

function handleDeleteTopicFile(fileId) {
  if (!selectedTopic) return;
  if (!requireTopicPermission("delete topic files")) return;

  const savedFile = (selectedTopic.files || []).find(
    (file) => file.id === fileId,
  );

  const pendingFile = topicFiles.find((file) => file.id === fileId);

  const fileToDelete = savedFile || pendingFile;

  if (!fileToDelete) return;

  const confirmDelete = window.confirm(
    `Delete "${fileToDelete.name}" from this topic?`,
  );

  if (!confirmDelete) return;

  // Xóa file đang chờ lưu
  setTopicFiles((prevFiles) =>
    prevFiles.filter((file) => file.id !== fileId),
  );

  // Xóa file đã lưu trong topic
  updateSelectedTopic((topic) => ({
    ...topic,
    files: (topic.files || []).filter((file) => file.id !== fileId),
  }));

  createAppNotification({
    category: "file",
    action: "deleted",
    title: "File deleted",
    message: `${profileName} deleted ${fileToDelete.name} from ${selectedTopic.title}.`,
    icon: "ti-trash",
    link: `/dashboard/workspaces/${workspaceId}`,
  });
}

  function handleTopicFileChange(e) {
    const selectedFiles = Array.from(e.target.files);

    if (selectedFiles.length === 0 || !selectedTopic) return;
    if (!requireTopicPermission("upload topic files")) {
      e.target.value = "";
      return;
    }

    const selectedFilesSize = selectedFiles.reduce(
      (total, file) => total + file.size,
      0,
    );

    const pendingFilesSize = topicFiles.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0,
    );

    const nextStorageUsed =
      workspaceStorageUsedBytes + pendingFilesSize + selectedFilesSize;

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

    const newFiles = selectedFiles.map((file) => ({
      id: `topic-file-${selectedTopic.id}-${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type,
      addedAt: "Added just now",
    }));

    setTopicFiles((prevFiles) => [...prevFiles, ...newFiles]);

createAppNotification({
  category: "file",
  action: "uploaded",
  title: "File uploaded",
  message: `${profileName} uploaded ${newFiles.length} file(s) to ${selectedTopic.title}.`,
  icon: "ti-folder",
  link: `/dashboard/workspaces/${workspaceId}`,
});

e.target.value = "";
  }

  function handleSaveTopicNote(e) {
  e.preventDefault();

  if (!selectedTopic) return;
  if (!requireTopicPermission("edit topic content")) return;

  const nextTopics = discussionTopics.map((topic) => {
    if (topic.id !== selectedTopic.id) return topic;

    const mergedFiles = [...(topic.files || []), ...topicFiles];

    const uniqueFiles = mergedFiles.filter(
      (file, index, array) =>
        index === array.findIndex((item) => item.id === file.id),
    );

    return {
      ...topic,
      content: topicContent,
      files: uniqueFiles,
      updatedAt: "Updated just now",
    };
  });

  saveDiscussionTopics(nextTopics);
  setTopicFiles([]);
}

  function updateSelectedTopic(updater) {
  if (!selectedTopic) return;

  const nextTopics = discussionTopics.map((topic) =>
    topic.id === selectedTopic.id
      ? {
          ...updater(topic),
          updatedAt: "Updated just now",
        }
      : topic,
  );

  saveDiscussionTopics(nextTopics);
}

function handleUpdateTopicField(field, value) {
  if (!requireTopicPermission("edit topic properties")) return;

  const previousStatus = selectedTopic?.status;

  updateSelectedTopic((topic) => ({
    ...topic,
    [field]: value,
  }));

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
}

function handleUpdateTopicDeadlineMode(value) {
  if (!requireTopicPermission("edit topic deadline")) return;

  updateSelectedTopic((topic) => ({
    ...topic,
    dateMode: value,
    startDate: value === "deadline" ? topic.startDate : "",
    endDate: value === "deadline" ? topic.endDate : "",
  }));
}

function handleUpdateTopicDate(field, value) {
  if (!requireTopicPermission("edit topic deadline")) return;

  updateSelectedTopic((topic) => ({
    ...topic,
    dateMode: "deadline",
    [field]: value,
  }));
}

function handleAddTopicComment(e) {
  e.preventDefault();

  if (!requireTopicPermission("comment on topics")) return;

  if (topicCommentInput.trim() === "") return;

  updateSelectedTopic((topic) => ({
    ...topic,
    comments: [
      ...(topic.comments || []),
      {
        id: `comment-${Date.now()}`,
        author: profileName,
        content: topicCommentInput.trim(),
        createdAt: "Just now",
      },
    ],
  }));

  setTopicCommentInput("");
}

function handleAddTopicSubtask(e) {
  e.preventDefault();

  if (!requireTopicPermission("create subtasks")) return;

  if (topicSubtaskInput.trim() === "") return;

  updateSelectedTopic((topic) => ({
    ...topic,
    subtasks: [
      ...(topic.subtasks || []),
      {
  id: `subtask-${Date.now()}`,
  title: topicSubtaskInput.trim(),
  completed: false,
  priority: subtaskPriority,
  dateMode: subtaskDateMode,
  startDate: subtaskDateMode === "deadline" ? subtaskStartDate : "",
  endDate: subtaskDateMode === "deadline" ? subtaskEndDate : "",
  assignee: profileName,
  createdAt: "Just now",
},
    ],
  }));

  setTopicSubtaskInput("");
setSubtaskPriority("");
setSubtaskDateMode("none");
setSubtaskStartDate("");
setSubtaskEndDate("");
setIsSubtaskEditing(false);
setIsSubtaskPriorityOpen(false);
setIsSubtaskDateOpen(false);
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

function handleToggleSubtask(subtaskId) {
  if (!requireTopicPermission("update subtasks")) return;

  updateSelectedTopic((topic) => ({
    ...topic,
    subtasks: (topic.subtasks || []).map((subtask) =>
      subtask.id === subtaskId
        ? { ...subtask, completed: !subtask.completed }
        : subtask,
    ),
  }));
}

function handleDeleteSubtask(subtaskId) {
  if (!requireTopicPermission("delete subtasks")) return;

  updateSelectedTopic((topic) => ({
    ...topic,
    subtasks: (topic.subtasks || []).filter(
      (subtask) => subtask.id !== subtaskId,
    ),
  }));
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
      await addWorkspaceMember(workspaceId, {
        userId: selectedUserId,
        role: inviteRole,
      });

      const refreshedMembers = await getWorkspaceMembers(workspaceId);
      setBackendMembers(refreshedMembers || []);
      handleCloseInviteModal();
      alert("Member added to workspace successfully.");
    } catch (error) {
      console.error("Cannot add workspace member:", error);
      setInviteError(getInviteErrorMessage(error));
    } finally {
      setIsAddingMember(false);
    }
  }

  function handleMessageAttachmentChange(e) {
    const selectedFile = e.target.files?.[0];

    if (!selectedFile) return;

    const isImage = selectedFile.type.startsWith("image/");

    setMessageAttachment({
      name: selectedFile.name,
      size: selectedFile.size,
      sizeLabel: formatMessageFileSize(selectedFile.size),
      type: selectedFile.type,
      isImage,
      previewUrl: isImage ? URL.createObjectURL(selectedFile) : "",
    });

    e.target.value = "";
  }

  function handleRemoveMessageAttachment() {
    if (messageAttachment?.previewUrl) {
      URL.revokeObjectURL(messageAttachment.previewUrl);
    }

    setMessageAttachment(null);
  }

  function handleSendMessage() {
    const trimmedMessage = messageText.trim();

    if (trimmedMessage === "" && !messageAttachment) return;

    const newMessage = {
      id: `msg-${Date.now()}`,
      senderName: profileName,
      text: trimmedMessage,
      time: `${getCurrentMessageTime()} · Sent`,
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
      await updateWorkspace(workspaceId, { name: trimmedName });
      setWorkspace((current) => ({ ...current, name: trimmedName }));
      setWorkspaceNameInput(trimmedName);
      setWorkspaceSettingMessage("Workspace name updated successfully.");
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
      await deleteWorkspace(workspaceId);

      localStorage.removeItem(`aiStudyHubWorkspaceIssues_${workspaceId}`);

      const recentWorkspaces = JSON.parse(
        localStorage.getItem("aiStudyHubRecentWorkspaces") || "[]",
      );
      const updatedRecentWorkspaces = recentWorkspaces.filter(
        (item) => item.id !== workspaceId,
      );
      localStorage.setItem(
        "aiStudyHubRecentWorkspaces",
        JSON.stringify(updatedRecentWorkspaces),
      );

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
  }

  function handlePreviousStudyCard() {
    setCurrentStudyCardIndex((currentIndex) =>
      currentIndex === 0 ? selectedStudySet.cards.length - 1 : currentIndex - 1,
    );
    setIsStudyCardFlipped(false);
  }

  function handleNextStudyCard() {
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
              14 members online
            </p>
          </div>

          <div className="workspace_message_header_actions">
            <button type="button" aria-label="View members">
              <i className="ti-user"></i>
            </button>

            <button type="button" aria-label="Conversation information">
              <i className="ti-info-alt"></i>
            </button>

            <div className="workspace_message_admin">
              <span>{profileName}</span>
              <img src="https://i.pravatar.cc/80?img=12" alt={profileName} />
            </div>
          </div>
        </header>

        <div className="workspace_message_day">Today</div>

        <section className="workspace_message_body">
          {chatMessages.map((message) => (
            <article
              className={`workspace_message_item ${message.isOwn ? "own" : ""}`}
              key={message.id}
            >
              {!message.isOwn && (
                <img
                  className="workspace_message_avatar"
                  src={message.avatar}
                  alt={message.senderName}
                />
              )}

              <div className="workspace_message_content_area">
                {!message.isOwn && <h3>{message.senderName}</h3>}

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
                  {message.time}
                </span>
              </div>
            </article>
          ))}
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
            >
              <i className="ti-control-play"></i>
            </button>
          </div>
        </section>

        <p className="workspace_message_hint">
          Press Enter to send, Shift + Enter for new line
        </p>
      </section>
    );
  }

  function renderMembersTab() {
    if (!canManageWorkspace) {
      return (
        <section className="workspace_permission_empty">
          <i className="ti-lock"></i>
          <h2>Admin access only</h2>
          <p>Only workspace admins can manage members and invitations.</p>
        </section>
      );
    }

    const workspaceMembers = [
      {
        name: "TrongBVD",
        email: "trongbvd@university.edu",
        role: "Manager",
        joinDate: "Oct 12, 2023",
        avatar: "https://i.pravatar.cc/80?img=11",
        isOnline: true,
      },
      {
        name: profileName,
        email: "d.khoa@academic.org",
        role: "Member",
        joinDate: "Jan 05, 2024",
        avatar: "https://i.pravatar.cc/80?img=14",
        isOnline: false,
      },
      {
        name: "aikirokito",
        email: "kito.ai@study.net",
        role: "Member",
        joinDate: "Mar 22, 2024",
        avatar: "https://i.pravatar.cc/80?img=33",
        isOnline: false,
      },
      {
        name: "Sarah Jenkins",
        email: "s.jenkins@university.edu",
        role: "Member",
        joinDate: "Jun 10, 2024",
        avatar: "https://i.pravatar.cc/80?img=47",
        isOnline: false,
      },
      {
        name: "Nguyễn Văn A",
        email: "v.a.nguyen@university.edu",
        role: "Member",
        joinDate: "Pending",
        avatar: "",
        isPending: true,
      },
    ];
    const visibleWorkspaceMembers =
      backendMembers.length > 0
        ? backendMembers.map((member) => ({
            id: member.user?.id,
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
          }))
        : workspaceMembers;

    return (
      <section className="workspace_member_tab">
        <section className="workspace_member_main">
          <div className="workspace_member_top">
            <div>
              <h2>Workspace Members</h2>
              <p>Manage access and roles for this academic resource center.</p>
            </div>

            <div className="workspace_member_actions">
              <div className="workspace_member_search">
                <i className="ti-search"></i>
                <input type="text" placeholder="Search members..." />
              </div>

              <button type="button" onClick={handleOpenInviteModal}>
                <i className="ti-user"></i>
                Add Member
              </button>
            </div>
          </div>

          <div className="workspace_member_table">
            <div className="workspace_member_table_header">
              <span>Member</span>
              <span>Role</span>
              <span>Join Date</span>
              <span>Actions</span>
            </div>

            {visibleWorkspaceMembers.map((member) => (
              <article
                className="workspace_member_row"
                key={member.id || member.email || member.name}
              >
                <div className="workspace_member_identity">
                  <div className="workspace_member_avatar">
                    {member.avatar ? (
                      <img src={member.avatar} alt={member.name} />
                    ) : (
                      <i className="ti-user"></i>
                    )}

                    {member.isOnline && <span></span>}
                  </div>

                  <div>
                    <strong>{member.name}</strong>
                    <p>{member.email}</p>
                  </div>
                </div>

                <span
                  className={`workspace_member_status ${
                    member.role === "Manager" ? "manager" : "member"
                  }`}
                >
                  {member.role}
                </span>

                <span
                  className={
                    member.isPending
                      ? "workspace_member_join_date pending"
                      : "workspace_member_join_date"
                  }
                >
                  {member.joinDate}
                </span>

                {member.isPending ? (
                  <button type="button" className="workspace_resend_btn">
                    Resend
                  </button>
                ) : (
                  <button type="button" aria-label="Member settings">
                    <i className="ti-settings"></i>
                  </button>
                )}
              </article>
            ))}
          </div>

          <p className="workspace_member_note">
            Note: Only members who have accepted their invitation or are
            explicitly listed as pending appear in this workspace list.
          </p>

          <section className="workspace_pending_card">
            <div className="workspace_pending_header">
              <h3>Pending Invitations</h3>
              <span>{pendingInvitations.length} Pending</span>
            </div>

            <div className="workspace_pending_list">
              {pendingInvitations.map((invitation) => (
                <article
                  className="workspace_pending_item"
                  key={invitation.email}
                >
                  <div className="workspace_pending_mail_icon">
                    <i className="ti-email"></i>
                  </div>

                  <div className="workspace_pending_info">
                    <strong>{invitation.email}</strong>
                    <p>
                      Invited {invitation.time} by {invitation.invitedBy}
                    </p>
                  </div>

                  <button type="button">Resend</button>
                </article>
              ))}
            </div>
          </section>
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
                <strong>42</strong>
                <span>Posts</span>
              </div>

              <div>
                <strong>12</strong>
                <span>Tasks</span>
              </div>
            </div>
          </section>

          <section className="workspace_side_card">
            <h3>Latest Activity</h3>

            <div className="workspace_latest_activity highlight">
              <strong>TrongBVD</strong>
              <p>updated the React Hooks guide.</p>
              <span>5 hours ago</span>
            </div>

            <div className="workspace_latest_activity">
              <strong>{profileName}</strong>
              <p>joined the hub.</p>
              <span>Yesterday</span>
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
  if (topicFilter === "Solved") return topic.status === "Solved";
  return topic.type === topicFilter;
});
    if (selectedTopic) {
  const relatedFiles = [...(selectedTopic.files || []), ...topicFiles];
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
          </div>
        </header>

<section className="workspace_topic_info_panel">
  <button
    type="button"
    className={`workspace_topic_info_item ${
      canManageTopics ? "editable" : "read_only"
    }`}
    onClick={() => canManageTopics && setEditingTopicField("type")}
    disabled={!canManageTopics}
  >
    <span>
      <i className="ti-bookmark-alt"></i>
      Type
    </span>

    {canManageTopics && editingTopicField === "type" ? (
      <select
        value={selectedTopic.type || "Question"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleUpdateTopicField("type", e.target.value);
          setEditingTopicField(null);
        }}
        onBlur={() => setEditingTopicField(null)}
        autoFocus
      >
        <option value="Question">Question</option>
        <option value="Material">Material</option>
        <option value="Announcement">Announcement</option>
        <option value="Discussion">Discussion</option>
      </select>
    ) : (
      <strong>{selectedTopic.type || "Question"}</strong>
    )}
  </button>

  <button
    type="button"
    className={`workspace_topic_info_item ${
      canManageTopics ? "editable" : "read_only"
    }`}
    onClick={() => canManageTopics && setEditingTopicField("status")}
    disabled={!canManageTopics}
  >
    <span>
      <i className="ti-target"></i>
      Status
    </span>

    {canManageTopics && editingTopicField === "status" ? (
      <select
        value={selectedTopic.status || "Open"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleUpdateTopicField("status", e.target.value);
          setEditingTopicField(null);
        }}
        onBlur={() => setEditingTopicField(null)}
        autoFocus
      >
        <option value="Open">Open</option>
        <option value="In progress">In progress</option>
        <option value="Solved">Solved</option>
        <option value="Closed">Closed</option>
      </select>
    ) : (
      <strong>{selectedTopic.status || "Open"}</strong>
    )}
  </button>

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
            subtask.completed ? "completed" : ""
          }`}
          key={subtask.id}
        >
          <button
            type="button"
            className="workspace_clickup_subtask_check"
            onClick={() => handleToggleSubtask(subtask.id)}
            disabled={!canManageTopics}
          >
            {subtask.completed ? <i className="ti-check"></i> : null}
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
              <strong>{file.name}</strong>
              <span>{file.addedAt || "Just now"}</span>
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

          <div>
            <button type="button">
              <i className="ti-search"></i>
            </button>

            <button type="button">
              <i className="ti-bell"></i>
            </button>

            <button type="button">
              <i className="ti-filter"></i>
            </button>
          </div>
        </header>

        <section className="workspace_clickup_activity_body">
          {comments.length === 0 ? (
            <div className="workspace_clickup_activity_empty">
              <i className="ti-comments"></i>
              <p>No activity yet.</p>
            </div>
          ) : (
            comments.map((comment) => (
              <article className="workspace_clickup_comment" key={comment.id}>
                <div className="workspace_clickup_comment_head">
                  <div className="workspace_clickup_comment_avatar">
                    {comment.author.slice(0, 1).toUpperCase()}
                  </div>

                  <strong>{comment.author}</strong>
                  <span>{comment.createdAt}</span>
                </div>

                <p>{comment.content}</p>

                <footer>
                  <button type="button">
                    <i className="ti-thumb-up"></i>
                  </button>

                  <button type="button">Reply</button>
                </footer>
              </article>
            ))
          )}
        </section>

        {canManageTopics ? (
          <form
            className="workspace_clickup_comment_form"
            onSubmit={handleAddTopicComment}
          >
            <textarea
              value={topicCommentInput}
              onChange={(e) => setTopicCommentInput(e.target.value)}
              placeholder="Write a comment..."
            />

            <div>
              <button type="button">
                <i className="ti-plus"></i>
              </button>

              <button type="submit">
                <i className="ti-control-play"></i>
              </button>
            </div>
          </form>
        ) : (
          <p className="workspace_permission_hint">
            Use the Message tab to chat with this workspace.
          </p>
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
    className={topicFilter === "Question" ? "active" : ""}
    onClick={() => setTopicFilter("Question")}
  >
    Questions
  </button>

  <button
    type="button"
    className={topicFilter === "Material" ? "active" : ""}
    onClick={() => setTopicFilter("Material")}
  >
    Materials
  </button>

  <button
    type="button"
    className={topicFilter === "Announcement" ? "active" : ""}
    onClick={() => setTopicFilter("Announcement")}
  >
    Announcements
  </button>

  <button
    type="button"
    className={topicFilter === "Solved" ? "active" : ""}
    onClick={() => setTopicFilter("Solved")}
  >
    Solved
  </button>
</div>
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
    <label>Topic type</label>
    <select
      value={newTopicType}
      onChange={(e) => setNewTopicType(e.target.value)}
    >
      <option value="Question">Question</option>
      <option value="Material">Material</option>
      <option value="Discussion">Discussion</option>
      <option value="Announcement">Announcement</option>
    </select>
  </div>

  <div className="discussion_form_group">
    <label>Status</label>
    <select
      value={newTopicStatus}
      onChange={(e) => setNewTopicStatus(e.target.value)}
    >
      <option value="Open">Open</option>
      <option value="In progress">In progress</option>
      <option value="Solved">Solved</option>
    </select>
  </div>

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
            {filteredDiscussionTopics.length > 0 && (
              <>
                <section className="discussion_pinned_card">
                  <div>
                    <span>PINNED</span>
                    <h3>Workspace rules and study schedule</h3>
                    <p>
                      Use this area for important group rules, deadlines,
                      meeting links, or exam review plans.
                    </p>
                  </div>

                  <i className="ti-pin-alt"></i>
                </section>

                <section className="discussion_topic_list">
                  {filteredDiscussionTopics.map((topic) => (
                    <article
                      className="discussion_topic_card"
                      key={topic.id}
                      onClick={() => {
  setSelectedTopicId(topic.id);
  setTopicContent(topic.content || "");
  setTopicFiles([]);
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
                          <i className="ti-comment-alt"></i>0 replies
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
    return (
      <section className="workspace_study_tab">
        <aside className="workspace_study_sidebar">
          <div className="workspace_study_sidebar_header">
            <h3>Flashcard Sets</h3>

            <button type="button" aria-label="Open flashcard library">
              <i className="ti-layout-grid2"></i>
            </button>
          </div>

          <button type="button" className="workspace_study_generate_btn">
            <i className="ti-plus"></i>
            Generate New
          </button>

          <div className="workspace_study_set_list">
            {studySets.map((studySet) => (
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
              <strong>AI Extraction</strong>
              <p>Analyzing System_Design_v2.pdf...</p>
            </section>
          </section>
        </aside>

        <section className="workspace_study_main">
          <header className="workspace_study_header">
            <div>
              <h2>{selectedStudySet.title}</h2>
              <p>{selectedStudySet.subtitle}</p>
            </div>

            <div className="workspace_study_progress">
              <div>
                <span
                  style={{
                    width: `${
                      ((currentStudyCardIndex + 1) /
                        selectedStudySet.cards.length) *
                      100
                    }%`,
                  }}
                ></span>
              </div>

              <p>
                <strong>Session Progress</strong>
                {currentStudyCardIndex + 1} of {selectedStudySet.cards.length}{" "}
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
              onClick={() => setIsStudyCardFlipped(!isStudyCardFlipped)}
            >
              <span>{isStudyCardFlipped ? "Answer" : "Question"}</span>

              <h3>
                {isStudyCardFlipped
                  ? currentStudyCard.answer
                  : currentStudyCard.question}
              </h3>

              <small>
                <i className="ti-mouse"></i>
                Click to flip
              </small>
            </button>

            <div className="workspace_study_controls">
              <button type="button" onClick={handlePreviousStudyCard}>
                <i className="ti-arrow-left"></i>
              </button>

              <button
                type="button"
                className="workspace_study_flip_btn"
                onClick={() => setIsStudyCardFlipped(!isStudyCardFlipped)}
              >
                <i className="ti-reload"></i>
                Flip Card
              </button>

              <button type="button" onClick={handleNextStudyCard}>
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
                <strong>14:2</strong>
                <p>This session</p>
              </section>
            </article>

            <article>
              <div className="workspace_study_stat_icon highlight">
                <i className="ti-bolt"></i>
              </div>

              <section>
                <span>Recall Rate</span>
                <strong>92%</strong>
                <p>Higher than average</p>
              </section>
            </article>

            <article>
              <div className="workspace_study_stat_icon">
                <i className="ti-headphone-alt"></i>
              </div>

              <section>
                <span>Focus Level</span>
                <strong>High</strong>
                <p>Keep it up!</p>
              </section>
            </article>
          </section>
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
              <p>Remove this workspace from your local workspace list.</p>
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
                      {user.role ? ` · ${user.role}` : ""}
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
          className={visibleActiveTab === "discussion" ? "active" : ""}
          onClick={() => setActiveTab("discussion")}
        >
          <i className="ti-comments"></i>
          Discussion
        </button>

        <button
          className={visibleActiveTab === "messages" ? "active" : ""}
          onClick={() => setActiveTab("messages")}
        >
          <i className="ti-comment-alt"></i>
          Message
        </button>

        {canManageTopics && (
          <button
            className={visibleActiveTab === "study" ? "active" : ""}
            onClick={() => setActiveTab("study")}
          >
            <i className="ti-book"></i>
            Study
          </button>
        )}

        {canManageWorkspace && (
          <>
            <button
              className={visibleActiveTab === "members" ? "active" : ""}
              onClick={() => setActiveTab("members")}
            >
              <i className="ti-user"></i>
              Member
            </button>

            <button
              className={visibleActiveTab === "settings" ? "active" : ""}
              onClick={() => setActiveTab("settings")}
            >
              <i className="ti-settings"></i>
              Setting
            </button>
          </>
        )}
      </nav>

      {visibleActiveTab === "messages" && renderMessagesTab()}

      {visibleActiveTab === "discussion" && renderDiscussionTab()}

      {visibleActiveTab === "study" && renderStudyTab()}

      {visibleActiveTab === "members" && renderMembersTab()}

      {visibleActiveTab === "settings" && renderSettingsTab()}

      {renderInviteMemberModal()}
    </main>
  );
}

export default WorkSpacePage;
