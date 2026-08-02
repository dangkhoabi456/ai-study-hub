import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LuLibraryBig } from "react-icons/lu";
import { FaRotate } from "react-icons/fa6";
import ActionPopup from "../../common/ActionPopup/ActionPopup.jsx";
import useActionPopup from "../../common/ActionPopup/useActionPopup.js";
import {
  TbFileText,
  TbFileTypeDoc,
  TbFileTypeDocx,
  TbFileTypePdf,
  TbFileTypeTxt,
} from "react-icons/tb";
import JSZip from "jszip";

import {
  getMyDocuments,
  getMyLibraryStorageUsage,
  uploadDocuments,
  suggestDocumentTags,
  downloadDocument,
  deleteDocument,
  getMyLibraries,
  getLibrary,
  updateLibrary,
  deleteLibrary,
  toggleLibraryStar,
  getLibraryEngagement,
} from "../../../utils/documentApi";
import {
  getAccessToken,
  getStoredUser,
  isTokenValid,
} from "../../../utils/authToken";
import { isLibraryStarred } from "../../../utils/starredLibraries";
import {
  downloadPublicDocument,
  getPublicLibrary,
  recordPublicLibraryDownload,
} from "../../../utils/publicApi";

import "./LibraryPage.css";
import "../../../assets/icons/themify-icons-font/themify-icons/themify-icons.css";

function getStoredUserRole() {
  try {
    const user = getStoredUser();
    return String(user?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function getAiTagFileCacheKey(files) {
  return (files || [])
    .map((file) => `${file.name}:${file.size}:${file.lastModified || 0}`)
    .join("|");
}

function getRetryAfterSeconds(error) {
  const retryAfter = error.response?.headers?.["retry-after"];
  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(1, Math.ceil((retryDate - Date.now()) / 1000));
  }

  return 60;
}

function LibraryPage() {
  const LIBRARY_NAME_MAX_LENGTH = 20;
  const LIBRARY_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
  const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".docx", ".txt"];
  const ALLOWED_UPLOAD_ACCEPT =
    ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
  const [libraryNameMessage, setLibraryNameMessage] = useState("");
  const [isStorageLimitPopupOpen, setIsStorageLimitPopupOpen] = useState(false);
  const { libraryId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    popup: actionPopup,
    showConfirm,
    showPrompt,
    showAlert,
    resolvePopup: resolveActionPopup,
  } = useActionPopup();
  const isGuest = getStoredUserRole() === "GUEST";

  function getLibraryOrganizationStorageKey() {
    const user = getStoredUser();
    const userId = user?.id || user?.user_id || user?.email || "anonymous";
    const activeLibraryId = libraryId || location.state?.library?.id || "default-library";

    return `aiStudyHubLibraryOrganization:${userId}:${activeLibraryId}`;
  }

  function readStoredLibraryItems() {
    if (isGuest) return [];

    try {
      const storedOrganization = JSON.parse(
        localStorage.getItem(getLibraryOrganizationStorageKey()) || "{}",
      );
      const storedFolders = Array.isArray(storedOrganization.folders)
        ? storedOrganization.folders
        : [];
      const importedItems = Array.isArray(location.state?.importedItems)
        ? location.state.importedItems
        : JSON.parse(
          localStorage.getItem(
            `aiStudyHubImportedLibraryItems:${libraryId}`,
          ) || "[]",
        );

      return [
        ...storedFolders,
        ...(Array.isArray(importedItems) ? importedItems : []),
      ].filter(
        (item, index, items) =>
          items.findIndex((candidate) => candidate.id === item.id) === index,
      );
    } catch (error) {
      console.error("Cannot restore library folders:", error);
      return [];
    }
  }

  function handleLibraryNameChange(e) {
    const nextValue = e.target.value;

    if (nextValue.length > LIBRARY_NAME_MAX_LENGTH) return;

    setLibraryName(nextValue);

    if (nextValue.length === LIBRARY_NAME_MAX_LENGTH) {
      setLibraryNameMessage(
        `Library name has reached the limit of ${LIBRARY_NAME_MAX_LENGTH} characters.`
      );
      return;
    }

    setLibraryNameMessage("");
  }
  function getInitialLibraryData() {
    const routeLibrary = location.state?.library;

    if (routeLibrary?.id) {
      return {
        ...routeLibrary,
        visibility:
          routeLibrary.visibility ||
          (routeLibrary.is_public !== undefined
            ? routeLibrary.is_public
              ? "public"
              : "private"
            : "public"),
        stars: Number(routeLibrary.stars) || 0,
        isStarred: Boolean(routeLibrary.isStarred),
      };
    }

    return {
      id: libraryId || "default-library",
      name: "AI-student-hub",
      description:
        "A learning library for storing study materials, organizing subjects, and using AI to review documents.",
      visibility: "public",
      documents: 0,
      updatedAt: "Updated just now",
      icon: "ti-archive",
      stars: 0,
      isStarred: false,
    };
  }

  function formatVisibility(value) {
    return value === "private" ? "Private" : "Public";
  }

  const folderIdRef = useRef(1);
  const [libraryData, setLibraryData] = useState(getInitialLibraryData);
  const currentUser = getStoredUser() || {};
  const currentUserId =
    currentUser.id ||
    currentUser._id ||
    currentUser.user_id ||
    currentUser.user?.id ||
    currentUser.profile?.id ||
    "";
  const libraryOwnerId =
    libraryData.user_id || libraryData.owner?.id || libraryData.owner_id || "";
  const isLibraryOwner =
    Boolean(currentUserId) &&
    Boolean(libraryOwnerId) &&
    String(currentUserId) === String(libraryOwnerId);
  const canManageLibrary = isLibraryOwner;
  const ownerDisplayName = isLibraryOwner
    ? "You"
    : libraryData.owner?.full_name ||
      libraryData.owner?.username ||
      libraryData.owner_name ||
      "Library owner";
  const authorName = isLibraryOwner ? "You" : ownerDisplayName;
  const [isStarred, setIsStarred] = useState(
    () => isLibraryStarred(libraryId) || Boolean(getInitialLibraryData().isStarred)
  );

  const [stars, setStars] = useState(() => {
    const base = Number(getInitialLibraryData().stars) || 0;
    return isLibraryStarred(libraryId) ? Math.max(base, 1) : base;
  });
  const [activeTab, setActiveTab] = useState("documents");
  const [documentSearch, setDocumentSearch] = useState("");
  const [currentFolder, setCurrentFolder] = useState(null);


  const [libraryName, setLibraryName] = useState(
    () => getInitialLibraryData().name,
  );
  const [libraryDescription, setLibraryDescription] = useState(
    () => getInitialLibraryData().description || "",
  );
  const [libraryVisibility, setLibraryVisibility] = useState(
    () => getInitialLibraryData().visibility || "public",
  );

  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingReplacementDocumentIds, setPendingReplacementDocumentIds] =
    useState([]);
  const [pendingFolderId, setPendingFolderId] = useState(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState(null);
  const duplicateConfirmResolverRef = useRef(null);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [hashtags, setHashtags] = useState(["", "", ""]);
  const [activeHashtagIndex, setActiveHashtagIndex] = useState(0);
  const hashtagInputRefs = useRef([]);
  const [tagErrors, setTagErrors] = useState([]);
  const [tagInputErrors, setTagInputErrors] = useState(["", "", ""]);
  const [aiRecommendedTags, setAiRecommendedTags] = useState([]);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);
  const [aiTagSuggestionError, setAiTagSuggestionError] = useState("");
  const [isAiTagRateLimited, setIsAiTagRateLimited] = useState(false);
  const aiTagRequestIdRef = useRef(0);
  const aiTagRequestInFlightRef = useRef(false);
  const aiTagCacheRef = useRef(new Map());
  const aiTagRateLimitTimerRef = useRef(null);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [documentPendingDelete, setDocumentPendingDelete] = useState(null);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isShareLinkCopied, setIsShareLinkCopied] = useState(false);

  const [libraryItems, setLibraryItems] = useState(readStoredLibraryItems);
  const [userStorageUsedBytes, setUserStorageUsedBytes] = useState(0);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const hasFinishedInitialDocumentLoadRef = useRef(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isExportingLibrary, setIsExportingLibrary] = useState(false);

  function requestDuplicateConfirmation(fileNames) {
    return new Promise((resolve) => {
      duplicateConfirmResolverRef.current = resolve;
      setDuplicateConfirm({ fileNames });
    });
  }

  function closeDuplicateConfirmation(shouldReplace) {
    duplicateConfirmResolverRef.current?.(shouldReplace);
    duplicateConfirmResolverRef.current = null;
    setDuplicateConfirm(null);
  }

  function sanitizeArchiveName(value, fallback = "file") {
    const safeValue = String(value || fallback)
      .replace(/[<>:"/\\|?*]+/g, "-")
      .trim();

    return safeValue || fallback;
  }

  async function handleDownloadLibrary() {
    if (isExportingLibrary) return;

    const libraryPackage = {
      version: 1,
      exportedAt: new Date().toISOString(),
      library: {
        ...libraryData,
        name: libraryName.trim() || libraryData.name,
        description: libraryDescription.trim() || libraryData.description,
        visibility: libraryVisibility,
        stars,
        isStarred,
      },
      items: libraryItems,
    };
    const safeLibraryName = sanitizeArchiveName(
      libraryPackage.library.name,
      "library",
    );

    try {
      setIsExportingLibrary(true);
      const zip = new JSZip();
      const filesFolder = zip.folder("files");
      const failedFiles = [];
      const folderItems = libraryItems.filter(
        (item) => item.type === "folder",
      );
      const foldersById = new Map(
        folderItems.map((folder) => [String(getFolderKey(folder)), folder]),
      );
      const folderPathCache = new Map();

      function getArchiveFolderPath(folderId) {
        if (folderId === null || folderId === undefined || folderId === "") {
          return "";
        }

        const normalizedFolderId = String(folderId);

        if (folderPathCache.has(normalizedFolderId)) {
          return folderPathCache.get(normalizedFolderId);
        }

        const pathParts = [];
        const visitedFolderIds = new Set();
        let selectedFolder = foldersById.get(normalizedFolderId);

        while (selectedFolder) {
          const selectedFolderId = String(getFolderKey(selectedFolder));

          if (visitedFolderIds.has(selectedFolderId)) break;
          visitedFolderIds.add(selectedFolderId);
          pathParts.unshift(
            sanitizeArchiveName(selectedFolder.name, "folder"),
          );

          const parentFolderId = selectedFolder.folderId;
          selectedFolder =
            parentFolderId === null ||
              parentFolderId === undefined ||
              parentFolderId === ""
              ? null
              : foldersById.get(String(parentFolderId));
        }

        const folderPath = pathParts.join("/");
        folderPathCache.set(normalizedFolderId, folderPath);
        return folderPath;
      }

      zip.file("library.json", JSON.stringify(libraryPackage, null, 2));

      folderItems.forEach((folder) => {
        const folderPath = getArchiveFolderPath(getFolderKey(folder));

        if (folderPath) {
          filesFolder.folder(folderPath);
        }
      });

      const downloadableItems = libraryItems.filter(
        (entry) => entry.type !== "folder",
      );
      const downloadBatchSize = 4;

      async function addItemToArchive(item) {
        const fileName = sanitizeArchiveName(item.name, "document");
        const folderPath = getArchiveFolderPath(item.folderId);
        const targetFolder = folderPath
          ? filesFolder.folder(folderPath)
          : filesFolder;

        if (!item.isBackendFile || !item.id) {
          failedFiles.push(`${item.name}: file content is not available from backend`);
          return;
        }

        try {
          const downloadData = item.isPublicFile
            ? await downloadPublicDocument(item.id)
            : await downloadDocument(item.id);
          if (!downloadData?.downloadUrl) {
            throw new Error("Missing download URL");
          }

          const response = await fetch(downloadData.downloadUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          targetFolder.file(fileName, await response.blob());
        } catch (error) {
          failedFiles.push(`${item.name}: ${error.message || "download failed"}`);
        }
      }

      for (let index = 0; index < downloadableItems.length; index += downloadBatchSize) {
        await Promise.all(
          downloadableItems
            .slice(index, index + downloadBatchSize)
            .map(addItemToArchive),
        );
      }

      if (failedFiles.length > 0) {
        zip.file(
          "export-report.txt",
          [
            "Some files could not be included in this archive:",
            "",
            ...failedFiles.map((message) => `- ${message}`),
          ].join("\n"),
        );
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `${safeLibraryName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      if (libraryVisibility === "public" && libraryId) {
        try {
          await recordPublicLibraryDownload(libraryId);
        } catch (metricError) {
          console.error("Could not record library download:", metricError);
        }
      }
    } catch (error) {
      console.error("Cannot export library:", error);
      alert("Cannot create the library ZIP. Please try again.");
    } finally {
      setIsExportingLibrary(false);
    }
  }

  function handleShareLibrary() {
    setIsShareLinkCopied(false);
    setIsShareModalOpen(true);
  }

  async function handleCopyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsShareLinkCopied(true);
    } catch (error) {
      console.error("Cannot copy library link:", error);
      setUploadNotice({
        type: "error",
        title: "Could not copy link",
        message: "Please select and copy the URL manually.",
      });
    }
  }

  async function handleToggleStar() {
    if (isGuest) {
      setUploadNotice({
        type: "error",
        title: "Sign in required",
        message: "Please sign in to star a library.",
      });
      return;
    }

    try {
      const result = await toggleLibraryStar(libraryId);
      setStars(Number(result?.stars) || 0);
      setIsStarred(Boolean(result?.isStarred));
      setLibraryData((current) => ({
        ...current,
        stars: Number(result?.stars) || 0,
        isStarred: Boolean(result?.isStarred),
      }));
    } catch (error) {
      console.error("Could not update library star:", error);
      setUploadNotice({
        type: "error",
        title: "Star was not saved",
        message: error.response?.data?.message || "Please try again.",
      });
    }
  }
  function countUploadedFiles(items) {
    return items.filter((item) => item.type !== "folder").length;
  }

  function syncLibraryDocumentCount(nextItems) {
    const nextDocumentCount = countUploadedFiles(nextItems);

    const updatedLibrary = {
      ...libraryData,
      name: libraryName.trim() || libraryData.name,
      description: libraryDescription.trim() || libraryData.description,
      visibility: libraryVisibility,
      documents: nextDocumentCount,
      updatedAt: "Updated just now",
    };

    setLibraryData(updatedLibrary);
  }

  function getFolderKey(folder) {
    return folder.id || folder.name;
  }

  function normalizeFolderName(folderName) {
    return String(folderName || "").trim().toLowerCase();
  }

  function hasFolderWithSameName(folderName, parentFolderId, ignoredFolderKey) {
    const normalizedName = normalizeFolderName(folderName);

    return libraryItems.some((item) => {
      if (item.type !== "folder") return false;
      if (ignoredFolderKey && getFolderKey(item) === ignoredFolderKey) {
        return false;
      }

      return (
        (item.folderId ?? null) === parentFolderId &&
        normalizeFolderName(item.name) === normalizedName
      );
    });
  }

  function getFileIconComponent(fileName) {
    const name = String(fileName || "").toLowerCase();

    if (name.endsWith(".pdf")) return TbFileTypePdf;
    if (name.endsWith(".docx")) return TbFileTypeDocx;
    if (name.endsWith(".doc")) return TbFileTypeDoc;
    if (name.endsWith(".txt")) return TbFileTypeTxt;

    return TbFileText;
  }

  function renderFileIcon(fileName) {
    const FileIcon = getFileIconComponent(fileName);

    return <FileIcon aria-hidden="true" />;
  }

  function formatDisplayFileName(fileName) {
    return String(fileName || "Untitled document")
      .replace(/\.(pdf|docx|txt)$/i, "")
      .replace(/[-_.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatFileSize(size) {
    const safeSize = Number(size) || 0;

    if (safeSize < 1024 * 1024) {
      return `${(safeSize / 1024).toFixed(0)} KB`;
    }

    return `${(safeSize / 1024 / 1024).toFixed(1)} MB`;
  }

  function countUsedStorageBytes(items) {
    return items
      .filter((item) => item.type !== "folder")
      .reduce((total, item) => total + (Number(item.sizeBytes) || 0), 0);
  }

  function mapBackendDocumentToLibraryItem(document, uploaderName = authorName) {
    const apiTags = (document.document_tags || [])
      .map((dt) => (dt.tags?.name ? `#${dt.tags.name}` : ""))
      .filter(Boolean);

    return {
      id: document.id,
      type: "file",
      libraryId: document.library_id,
      name: document.title || "Untitled document",
      note: `${formatFileSize(document.file_size_bytes || 0)} · Uploaded`,
      size: formatFileSize(document.file_size_bytes || 0),
      sizeBytes: Number(document.file_size_bytes) || 0,
      uploadedTime: document.created_at
        ? new Date(document.created_at).toLocaleString()
        : "Recently",
      uploadedBy: uploaderName,
      icon: null,
      folderId: null,
      hashtags: apiTags,
      isBackendFile: true,
    };
  }

  async function refreshMyLibraryStorageUsage() {
    if (isGuest) return;

    try {
      const usage = await getMyLibraryStorageUsage();
      setUserStorageUsedBytes(Number(usage?.usedBytes) || 0);
    } catch (error) {
      console.error("Cannot load shared library storage usage:", error);
    }
  }

  async function loadBackendDocuments() {
    try {
      setIsLoadingDocuments(true);

      if (isGuest) {
        const publicLibrary = await getPublicLibrary(libraryId);
        const nextLibraryData = {
          ...publicLibrary.library,
          isPublicView: true,
          visibility: "public",
          updatedAt: publicLibrary.library.created_at
            ? new Date(publicLibrary.library.created_at).toLocaleString()
            : "Updated just now",
        };

        setLibraryData(nextLibraryData);
        setLibraryName(nextLibraryData.name || "Public Library");
        setLibraryVisibility("public");
        setStars(Number(nextLibraryData.stars) || 0);
        setIsStarred(false);
        setLibraryItems(
          (publicLibrary.documents || []).map((document) => ({
            ...mapBackendDocumentToLibraryItem(
              document,
              nextLibraryData.owner?.full_name ||
                nextLibraryData.owner?.username ||
                "Library owner",
            ),
            isPublicFile: true,
          })),
        );
        return;
      }
      let currentLibData = libraryData;
      if (!isGuest) {
        if (libraryId) {
          const routeLibrary =
            String(location.state?.library?.id) === String(libraryId)
              ? location.state.library
              : null;
          let myLibraries = [];

          try {
            myLibraries = await getMyLibraries();
          } catch (err) {
            if (!routeLibrary?.isOwned) throw err;
            console.error(
              "Using the owned library supplied by Recent Library:",
              err,
            );
          }

          const ownedLibrary = (myLibraries || []).find(
            (item) => String(item.id) === String(libraryId),
          ) || (routeLibrary?.isOwned ? routeLibrary : null);

          if (ownedLibrary) {
            let lib = ownedLibrary;

            try {
              lib = (await getLibrary(libraryId)) || ownedLibrary;
            } catch (err) {
              console.error(
                "Using owned library metadata from the library list:",
                err,
              );
            }

            currentLibData = {
              ...lib,
              ...ownedLibrary,
              id: ownedLibrary.id || lib.id,
              user_id:
                ownedLibrary.user_id || lib.user_id || currentUserId,
              name: ownedLibrary.name || lib.name || "Untitled Library",
              description: ownedLibrary.description || lib.description || "",
              visibility:
                (ownedLibrary.is_public ?? lib.is_public)
                  ? "public"
                  : "private",
              updatedAt: (ownedLibrary.updated_at || lib.updated_at)
                ? new Date(
                    ownedLibrary.updated_at || lib.updated_at,
                  ).toLocaleString()
                : "Updated just now",
              icon: "ti-archive",
              stars: Number(lib.stars ?? ownedLibrary.stars) || 0,
              downloads:
                Number(lib.downloads ?? ownedLibrary.downloads) || 0,
              isStarred: Boolean(
                lib.isStarred ?? ownedLibrary.isStarred,
              ),
              isOwned: true,
              isPublicView: false,
            };
            setLibraryData(currentLibData);
            setLibraryName(currentLibData.name);
            setLibraryDescription(currentLibData.description);
            setLibraryVisibility(currentLibData.visibility);
            setStars(currentLibData.stars);
            setIsStarred(currentLibData.isStarred);
          } else {
            const publicLibrary = await getPublicLibrary(libraryId);
            const engagement = await getLibraryEngagement(libraryId);
            const nextLibraryData = {
              ...publicLibrary.library,
              ...engagement,
              isPublicView: true,
              visibility: "public",
              updatedAt: publicLibrary.library.created_at
                ? new Date(publicLibrary.library.created_at).toLocaleString()
                : "Updated just now",
            };

            setLibraryData(nextLibraryData);
            setLibraryName(nextLibraryData.name || "Public Library");
            setLibraryDescription(nextLibraryData.description || "");
            setLibraryVisibility("public");
            setStars(Number(nextLibraryData.stars) || 0);
            setIsStarred(Boolean(nextLibraryData.isStarred));
            setLibraryItems(
              (publicLibrary.documents || []).map((document) => ({
                ...mapBackendDocumentToLibraryItem(document),
                isPublicFile: true,
              })),
            );
            return;
          }
        }
      }
      const activeLibraryId = String(currentLibData?.id || libraryId || "");
      const accessToken = getAccessToken();

      if (!isTokenValid(accessToken)) {
        return;
      }

      const backendDocuments = await getMyDocuments(activeLibraryId);
      await refreshMyLibraryStorageUsage();
      let storedDocumentFolderIds = {};

      try {
        const storedOrganization = JSON.parse(
          localStorage.getItem(getLibraryOrganizationStorageKey()) || "{}",
        );
        storedDocumentFolderIds = storedOrganization.documentFolderIds || {};
      } catch (error) {
        console.error("Cannot restore document folders:", error);
      }

      setLibraryItems((currentItems) => {
        const savedBackendItems = new Map(
          currentItems
            .filter((item) => item.isBackendFile && item.id)
            .map((item) => [String(item.id), item]),
        );
        const backendItems = (backendDocuments || []).map((document) => {
          const mappedItem = mapBackendDocumentToLibraryItem(document);
          const savedItem = savedBackendItems.get(String(document.id));
          const storedFolderId = storedDocumentFolderIds[String(document.id)];

          return {
            ...mappedItem,
            folderId: savedItem?.folderId ?? storedFolderId ?? null,
          };
        });
        const backendItemIds = new Set(
          backendItems.map((item) => String(item.id)),
        );
        const legacySavedBackendItems = Array.from(savedBackendItems.values())
          .filter((item) => !backendItemIds.has(String(item.id)))
          .filter(
            (item) =>
              typeof item.name === "string" && item.name.trim().length > 0,
          )
          .filter((item) => {
            if (!item.libraryId) return true;
            return String(item.libraryId) === activeLibraryId;
          })
          .map((item) => ({
            ...item,
            libraryId: item.libraryId || activeLibraryId,
          }));
        const localItems = currentItems.filter(
          (item) => !item.isBackendFile,
        );
        const nextItems = [
          ...localItems,
          ...legacySavedBackendItems,
          ...backendItems,
        ];

        syncLibraryDocumentCount(nextItems);

        return nextItems;
      });
    } catch (error) {
      console.error("Cannot load documents:", error);
      if (!isGuest && error?.response?.status === 401) {
        return;
      }

      alert(
        isGuest
          ? "Cannot load this public library."
          : "Cannot load documents. Please login again.",
      );
    } finally {
      hasFinishedInitialDocumentLoadRef.current = true;
      setIsLoadingDocuments(false);
    }
  }
  useEffect(() => {
    async function fetchDocuments() {
      await loadBackendDocuments();
    }

    setActiveTab("documents");
    setCurrentFolder(null);
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, isGuest]);

  useEffect(() => {
    if (isGuest || !hasFinishedInitialDocumentLoadRef.current) return;

    const folders = libraryItems.filter((item) => item.type === "folder");
    const documentFolderIds = Object.fromEntries(
      libraryItems
        .filter(
          (item) => item.type !== "folder" && item.id && item.folderId != null,
        )
        .map((item) => [String(item.id), item.folderId]),
    );

    localStorage.setItem(
      getLibraryOrganizationStorageKey(),
      JSON.stringify({ folders, documentFolderIds }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryItems, libraryId, isGuest, isLoadingDocuments]);

  useEffect(() => {
    if (!uploadNotice) return undefined;

    const timeoutId = window.setTimeout(() => {
      setUploadNotice(null);
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [uploadNotice]);

  useEffect(
    () => () => {
      if (aiTagRateLimitTimerRef.current) {
        window.clearTimeout(aiTagRateLimitTimerRef.current);
      }
    },
    [],
  );

  async function loadAiRecommendedTags(files) {
    if (
      !files?.length ||
      aiTagRequestInFlightRef.current ||
      isAiTagRateLimited
    ) {
      return;
    }

    const cacheKey = getAiTagFileCacheKey(files);
    const cachedTags = aiTagCacheRef.current.get(cacheKey);

    if (cachedTags?.length > 0) {
      setAiRecommendedTags(cachedTags);
      setAiTagSuggestionError("");
      return;
    }

    const requestId = ++aiTagRequestIdRef.current;
    aiTagRequestInFlightRef.current = true;
    setAiRecommendedTags([]);
    setAiTagSuggestionError("");
    setIsLoadingAiTags(true);

    try {
      const recommendedTags = await suggestDocumentTags(files);
      if (recommendedTags.length > 0) {
        aiTagCacheRef.current.set(cacheKey, recommendedTags);
      }
      if (requestId === aiTagRequestIdRef.current) {
        setAiRecommendedTags(recommendedTags);
        if (recommendedTags.length === 0) {
          setAiTagSuggestionError("AI could not find suitable tags. You can try again.");
        }
      }
    } catch (error) {
      const errorCode = error.response?.data?.code;
      const isRateLimited =
        error.response?.status === 429 || errorCode === "AI_QUOTA_EXHAUSTED";
      const isAiServiceUnavailable =
        error.response?.status === 503 ||
        errorCode === "AI_SERVICE_UNAVAILABLE";

      if (!isRateLimited && !isAiServiceUnavailable) {
        console.error("Cannot load AI tag suggestions:", error);
      }

      if (requestId === aiTagRequestIdRef.current) {
        setAiRecommendedTags([]);

        if (isRateLimited) {
          const retryAfterSeconds = getRetryAfterSeconds(error);
          setIsAiTagRateLimited(true);
          setAiTagSuggestionError(
            `Too many AI requests. Please try again in ${retryAfterSeconds} seconds.`,
          );

          if (aiTagRateLimitTimerRef.current) {
            window.clearTimeout(aiTagRateLimitTimerRef.current);
          }

          aiTagRateLimitTimerRef.current = window.setTimeout(() => {
            setIsAiTagRateLimited(false);
            setAiTagSuggestionError("");
            aiTagRateLimitTimerRef.current = null;
          }, retryAfterSeconds * 1000);
        } else {
          setAiTagSuggestionError(
            error.response?.data?.message ||
              "Unable to load AI suggestions. Please try again.",
          );
        }
      }
    } finally {
      aiTagRequestInFlightRef.current = false;
      if (requestId === aiTagRequestIdRef.current) {
        setIsLoadingAiTags(false);
      }
    }
  }

  async function handleUploadFile(e) {
    if (!canManageLibrary) {
      e.target.value = "";
      return;
    }

    const files = Array.from(e.target.files || []);

    if (files.length === 0) return;

    const MAX_SIZE = 50 * 1024 * 1024;
    const validFiles = [];
    const tooLargeFiles = [];
    const unsupportedFiles = [];

    files.forEach((file) => {
      const fileName = String(file.name || "").toLowerCase();
      const isAllowedFile = ALLOWED_UPLOAD_EXTENSIONS.some((extension) =>
        fileName.endsWith(extension),
      );

      if (!isAllowedFile) {
        unsupportedFiles.push(file.name);
      } else if (file.size > MAX_SIZE) {
        tooLargeFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    });

    if (unsupportedFiles.length > 0) {
      await showAlert(
        `Only PDF, DOCX, and TXT files are allowed:\n- ${unsupportedFiles.join(
          "\n- ",
        )}\n\nPlease convert old DOC files to DOCX before uploading.`,
        {
          title: "Unsupported file format",
          confirmText: "Choose another file",
        },
      );
    }

    if (tooLargeFiles.length > 0) {
      await showAlert(
        `These files exceed the 50MB limit:\n- ${tooLargeFiles.join("\n- ")}`,
        {
          title: "File is too large",
          confirmText: "Got it",
        },
      );
    }

    if (validFiles.length === 0) {
      e.target.value = "";
      return;
    }

    const selectedNames = new Set();
    const duplicateBatchFileNames = [];
    const uniqueFiles = validFiles.filter((file) => {
      const normalizedName = String(file.name || "").trim().toLocaleLowerCase();

      if (selectedNames.has(normalizedName)) {
        duplicateBatchFileNames.push(file.name);
        return false;
      }

      selectedNames.add(normalizedName);
      return true;
    });

    if (duplicateBatchFileNames.length > 0) {
      await showAlert(
        `These files were selected more than once and will only be uploaded once:\n- ${duplicateBatchFileNames.join(
          "\n- ",
        )}`,
        {
          title: "Duplicate file selection",
          confirmText: "Continue",
        },
      );
    }

    const acceptedFiles = [];
    const replacementDocumentIds = [];
    const declinedDuplicateNames = [];

    for (const file of uniqueFiles) {
      const normalizedName = String(file.name || "").trim().toLocaleLowerCase();
      const existingDocument = libraryItems.find(
        (item) =>
          item.type !== "folder" &&
          String(item.name || "").trim().toLocaleLowerCase() === normalizedName,
      );

      if (!existingDocument) {
        acceptedFiles.push(file);
        replacementDocumentIds.push(null);
        continue;
      }

      const shouldReplace = await requestDuplicateConfirmation([file.name]);

      if (!shouldReplace) {
        declinedDuplicateNames.push(file.name);
        continue;
      }

      if (!existingDocument.id || !existingDocument.isBackendFile) {
        alert(`"${file.name}" cannot be replaced because its saved document record is incomplete.`);
        continue;
      }

      acceptedFiles.push(file);
      replacementDocumentIds.push(String(existingDocument.id));
    }

    if (declinedDuplicateNames.length > 0) {
      setUploadNotice({
        type: "warning",
        message: `${declinedDuplicateNames.length} existing ${
          declinedDuplicateNames.length === 1 ? "document was" : "documents were"
        } kept and not uploaded again.`,
      });
    }

    if (acceptedFiles.length === 0) {
      e.target.value = "";
      return;
    }

    const replacementIdSet = new Set(
      replacementDocumentIds.filter(Boolean).map(String),
    );
    const replacementSize = libraryItems.reduce(
      (total, item) =>
        replacementIdSet.has(String(item.id))
          ? total + (Number(item.sizeBytes) || 0)
          : total,
      0,
    );
    const selectedFilesSize = acceptedFiles.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0
    );

    const currentUsedStorage = userStorageUsedBytes;
    const nextUsedStorage =
      currentUsedStorage - replacementSize + selectedFilesSize;

    if (nextUsedStorage > LIBRARY_STORAGE_LIMIT_BYTES) {
      setIsStorageLimitPopupOpen(true);
      e.target.value = "";
      return;
    }

    setPendingFiles(acceptedFiles);
    setPendingReplacementDocumentIds(replacementDocumentIds);
    setPendingFolderId(currentFolder ? getFolderKey(currentFolder) : null);
    setHashtags(["", "", ""]);
    setActiveHashtagIndex(0);
    aiTagRequestIdRef.current += 1;
    setAiRecommendedTags([]);
    setAiTagSuggestionError("");
    setIsLoadingAiTags(false);
    setIsTagModalOpen(true);

    e.target.value = "";
  }

  function handleHashtagChange(index, value) {
    const updatedHashtags = [...hashtags];
    updatedHashtags[index] = value;
    setHashtags(updatedHashtags);
    setTagErrors([]);
    setTagInputErrors(["", "", ""]);
    setUploadNotice((currentNotice) =>
      currentNotice?.title === "AI hashtag verification failed"
        ? null
        : currentNotice,
    );
  }

  function handleApplyAllSuggestedTags() {
    setHashtags((currentTags) => {
      const nextTags = [...currentTags];
      const invalidTagReplacements = new Map(
        tagErrors
          .filter(
            (validation) =>
              validation?.isValid === false &&
              String(validation.recommendedReplacement || "").trim(),
          )
          .map((validation) => [
            String(validation.tag || "")
              .trim()
              .replace(/^#/, "")
              .toLocaleLowerCase(),
            String(validation.recommendedReplacement).trim(),
          ]),
      );

      for (let index = 0; index < nextTags.length; index += 1) {
        const normalizedCurrentTag = String(nextTags[index] || "")
          .trim()
          .replace(/^#/, "")
          .toLocaleLowerCase();
        const replacement = invalidTagReplacements.get(normalizedCurrentTag);

        if (replacement) {
          nextTags[index] = replacement;
        }
      }

      for (const suggestedTag of aiRecommendedTags) {
        const normalizedSuggestion = suggestedTag.trim().toLocaleLowerCase();
        const alreadyApplied = nextTags.some(
          (tag) => tag.trim().toLocaleLowerCase() === normalizedSuggestion,
        );
        const emptyIndex = nextTags.findIndex((tag) => tag.trim() === "");

        if (!alreadyApplied && emptyIndex !== -1) {
          nextTags[emptyIndex] = suggestedTag;
        }
      }

      return nextTags;
    });
    setTagErrors([]);
    setTagInputErrors(["", "", ""]);
    setUploadNotice((currentNotice) =>
      currentNotice?.title === "AI hashtag verification failed"
        ? null
        : currentNotice,
    );
  }

  function handleCancelTaggedUpload() {
    aiTagRequestIdRef.current += 1;
    setPendingFiles([]);
    setPendingReplacementDocumentIds([]);
    setPendingFolderId(null);
    setHashtags(["", "", ""]);
    setActiveHashtagIndex(0);
    setTagErrors([]);
    setTagInputErrors(["", "", ""]);
    setAiRecommendedTags([]);
    setAiTagSuggestionError("");
    setIsLoadingAiTags(false);
    setIsTagModalOpen(false);
  }

  async function handleConfirmTaggedUpload() {
    const normalizedTags = hashtags.map((tag) =>
      tag.trim().replace(/^#/, "").trim(),
    );
    const nextTagInputErrors = ["", "", ""];
    const tagIndexesByValue = new Map();

    normalizedTags.forEach((tag, index) => {
      if (!tag) return;

      if (/^\d/.test(tag)) {
        nextTagInputErrors[index] = "A tag cannot start with a number.";
      }

      const normalizedValue = tag.toLocaleLowerCase();
      const matchingIndexes = tagIndexesByValue.get(normalizedValue) || [];
      matchingIndexes.push(index);
      tagIndexesByValue.set(normalizedValue, matchingIndexes);
    });

    tagIndexesByValue.forEach((indexes) => {
      if (indexes.length < 2) return;

      indexes.forEach((index) => {
        nextTagInputErrors[index] = "Tags must be unique.";
      });
    });

    const validHashtags = normalizedTags
      .filter(Boolean)
      .map((tag) => `#${tag}`);

    if (validHashtags.length < 1 || validHashtags.length > 3) {
      nextTagInputErrors[0] =
        nextTagInputErrors[0] || "Please enter at least one tag.";
    }

    if (nextTagInputErrors.some(Boolean)) {
      setTagInputErrors(nextTagInputErrors);
      return;
    }

    if (pendingFiles.length === 0) {
      alert("Please choose at least one file.");
      return;
    }

    try {
      setIsUploadingDocuments(true);
      setUploadProgress(0);

      const workspaceId = libraryData?.workspaceId || libraryData?.workspace_id;
      let effectiveReplacementIds = [...pendingReplacementDocumentIds];

      async function submitUpload(replacementIds) {
        return uploadDocuments(
          pendingFiles,
          workspaceId,
          libraryData.id || libraryId,
          validHashtags,
          setUploadProgress,
          replacementIds,
        );
      }

      let uploadedDocuments;

      try {
        uploadedDocuments = await submitUpload(effectiveReplacementIds);
      } catch (uploadError) {
        const duplicateData = uploadError.response?.data;

        if (duplicateData?.code !== "DUPLICATE_DOCUMENT") {
          throw uploadError;
        }

        const duplicateDocuments = Array.isArray(duplicateData.duplicates)
          ? duplicateData.duplicates
          : [];
        const duplicateInBatch = duplicateDocuments.find(
          (duplicate) => !duplicate.documentId,
        );

        if (duplicateInBatch) {
          alert(
            `"${duplicateInBatch.fileName}" was selected more than once. Remove the duplicate selection and try again.`,
          );
          return;
        }

        const duplicateNames = duplicateDocuments
          .map((duplicate) => duplicate.fileName)
          .filter(Boolean);
        const shouldReplace = await requestDuplicateConfirmation(duplicateNames);

        if (!shouldReplace) {
          setUploadNotice({
            type: "warning",
            message: "The existing document was kept and no duplicate was uploaded.",
          });
          return;
        }

        effectiveReplacementIds = pendingFiles.map((_, fileIndex) => {
          const duplicate = duplicateDocuments.find(
            (item) => item.fileIndex === fileIndex,
          );
          return duplicate?.documentId || effectiveReplacementIds[fileIndex] || null;
        });
        setPendingReplacementDocumentIds(effectiveReplacementIds);
        setUploadProgress(0);
        uploadedDocuments = await submitUpload(effectiveReplacementIds);
      }

      const uploadedDocumentEntries = (uploadedDocuments || []).map(
        (document, index) => ({ document, index }),
      );
      const approvedDocumentEntries = uploadedDocumentEntries.filter(
        ({ document }) =>
          String(document.status || "").toUpperCase() === "APPROVED",
      );
      const reviewDocumentEntries = uploadedDocumentEntries.filter(
        ({ document }) =>
          String(document.status || "").toUpperCase() !== "APPROVED",
      );

      const uploadedItems = approvedDocumentEntries.map(({ document, index }) => ({
        ...mapBackendDocumentToLibraryItem(document),
        sizeBytes:
          Number(document.file_size_bytes) ||
          Number(pendingFiles[index]?.size) ||
          0,
        size:
          formatFileSize(
            Number(document.file_size_bytes) ||
            Number(pendingFiles[index]?.size) ||
            0
          ),
        folderId: pendingFolderId,
        hashtags: validHashtags,
      }));

      const replacedDocumentIds = new Set([
        ...effectiveReplacementIds.filter(Boolean).map(String),
        ...(uploadedDocuments || []).flatMap((document) =>
          Array.isArray(document.replaced_document_ids)
            ? document.replaced_document_ids.map(String)
            : [],
        ),
      ]);

      setLibraryItems((currentItems) => {
        const retainedItems = currentItems.filter(
          (item) => !replacedDocumentIds.has(String(item.id)),
        );
        const nextItems = [...uploadedItems, ...retainedItems];
        syncLibraryDocumentCount(nextItems);
        return nextItems;
      });
      await refreshMyLibraryStorageUsage();

      handleCancelTaggedUpload();

      if (reviewDocumentEntries.length > 0) {
        setUploadNotice({
          type: "warning",
          title: "Sent to admin review",
          message:
            `${reviewDocumentEntries.length} ${
              reviewDocumentEntries.length === 1 ? "document was" : "documents were"
            } not added to the library yet because AI marked ${
              reviewDocumentEntries.length === 1 ? "it" : "them"
            } for admin review.`,
        });
      } else {
        setUploadNotice({
          type: "success",
          message:
            replacedDocumentIds.size > 0
              ? `${replacedDocumentIds.size} ${
                  replacedDocumentIds.size === 1 ? "document" : "documents"
                } replaced successfully.`
              : uploadedItems.length === 1
              ? "File uploaded successfully."
              : `${uploadedItems.length} files uploaded successfully.`,
        });
      }
    } catch (error) {
      console.error("Upload failed:", error);
      
      if (error.response?.data?.code === "TAG_VALIDATION_FAILED") {
        setTagErrors(error.response.data.tagValidations || []);
        setAiRecommendedTags(error.response.data.aiRecommendedTags || []);
        setUploadNotice({
          type: "error",
          title: "AI hashtag verification failed",
          message: "Please check the recommendations next to the tag fields.",
        });
      } else if (error.response?.data?.code === "SENSITIVE_CONTENT_BLOCKED") {
        setUploadNotice({
          type: "error",
          title: "Upload blocked",
          message:
            error.response.data.message ||
            "This document contains inappropriate language and cannot be uploaded.",
        });
      } else if (error.response?.data?.code === "TAG_INPUT_INVALID") {
        setTagInputErrors([
          error.response.data.message || "Please check your tags.",
          "",
          "",
        ]);
      } else {
        alert(error.response?.data?.message || error.response?.data?.error || "Upload failed. Please check backend and Supabase.");
      }
    } finally {
      setIsUploadingDocuments(false);
      setUploadProgress(0);
    }
  }

  async function handleCreateFolder() {
    if (!canManageLibrary) return;

    const folderName = await showPrompt("Enter a name for the new folder.", "", {
      title: "Create folder",
      placeholder: "Folder name",
      confirmText: "Create folder",
    });

    if (!folderName || folderName.trim() === "") return;

    const trimmedFolderName = folderName.trim();
    const parentFolderId = currentFolder ? getFolderKey(currentFolder) : null;

    if (hasFolderWithSameName(trimmedFolderName, parentFolderId)) {
      alert("A folder with this name already exists in the same location.");
      return;
    }

    const newFolder = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? `folder-${crypto.randomUUID()}`
          : `folder-${libraryId || "local"}-${folderIdRef.current++}`,
      type: "folder",
      name: trimmedFolderName,
      note: "0 files · Created just now",
      icon: "ti-folder",
      folderId: parentFolderId,
    };

    setLibraryItems((currentItems) => [newFolder, ...currentItems]);
  }

  function handleOpenFolder(folder) {
    setCurrentFolder(folder);
    setDocumentSearch("");
  }

  function handleBackToLibrary() {
    setCurrentFolder(null);
    setDocumentSearch("");
  }

  function getFolderPath(folder) {
    const path = [];
    const visitedFolderIds = new Set();
    let selectedFolder = folder;

    while (selectedFolder) {
      const selectedFolderId = getFolderKey(selectedFolder);

      if (visitedFolderIds.has(selectedFolderId)) break;
      visitedFolderIds.add(selectedFolderId);
      path.unshift(selectedFolder);

      const parentFolderId = selectedFolder.folderId ?? null;
      if (!parentFolderId) break;

      selectedFolder = libraryItems.find(
        (item) =>
          item.type === "folder" &&
          getFolderKey(item) === parentFolderId,
      );
    }

    return path;
  }

  function handleOpenBreadcrumbFolder(folder) {
    setCurrentFolder(folder);
    setDocumentSearch("");
  }

  function handleDeleteDocument(fileItem) {
    setDocumentPendingDelete(fileItem);
  }

  async function handleConfirmDeleteDocument() {
    if (!documentPendingDelete || isDeletingDocument) return;
    if (!canManageLibrary) {
      setDocumentPendingDelete(null);
      return;
    }
    const fileItem = documentPendingDelete;
    try {
      setIsDeletingDocument(true);
      if (fileItem.id && fileItem.isBackendFile) {
        await deleteDocument(fileItem.id);
      }

      setLibraryItems((currentItems) => {
        const nextItems = currentItems.filter((item) =>
          fileItem.id
            ? item.id !== fileItem.id
            : item.name !== fileItem.name
        );
        syncLibraryDocumentCount(nextItems);
        return nextItems;
      });
      await refreshMyLibraryStorageUsage();

      setDocumentPendingDelete(null);
      setUploadNotice({
        type: "success",
        title: "Document deleted",
        message: `“${formatDisplayFileName(fileItem.name)}” was deleted successfully.`,
      });
    } catch (error) {
      console.error("Delete failed:", error);
      setDocumentPendingDelete(null);
      setUploadNotice({
        type: "error",
        title: "Could not delete document",
        message: "Delete failed. Please try again.",
      });
    } finally {
      setIsDeletingDocument(false);
    }
  }

  async function handleDownloadDocument(fileItem) {
    try {
      if (!fileItem.id || !fileItem.isBackendFile) {
        alert(
          "This file is local sample data, so it cannot be downloaded from backend yet.",
        );
        return;
      }

      const data = isGuest || fileItem.isPublicFile
        ? await downloadPublicDocument(fileItem.id)
        : await downloadDocument(fileItem.id);

      if (!data.downloadUrl) {
        alert("Download URL not found.");
        return;
      }

      window.open(data.downloadUrl, "_blank");
    } catch (error) {
      console.error("Download failed:", error);
      alert("Download failed.");
    }
  }

  function handleViewDocument(fileItem) {
    if (!fileItem.id || !fileItem.isBackendFile) {
      alert("This file is local sample data, so it cannot be opened in the viewer yet.");
      return;
    }

    navigate(`/dashboard/documents/${fileItem.id}`, {
      state: {
        from: `/dashboard/libraries/${libraryId}`,
        fileName: formatDisplayFileName(fileItem.name),
      },
    });
  }

  async function handleSaveSettings(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (!canManageLibrary) return;

    const rawLibraryName = libraryName;
    const trimmedLibraryName = rawLibraryName.trim();

    if (trimmedLibraryName === "") {
      setLibraryNameMessage("Please enter library name.");
      return;
    }

    if (rawLibraryName.length > LIBRARY_NAME_MAX_LENGTH) {
      setLibraryNameMessage(
        `Library name cannot exceed ${LIBRARY_NAME_MAX_LENGTH} characters.`
      );
      return;
    }

    try {
      await updateLibrary(libraryData.id || libraryId, {
        name: trimmedLibraryName,
        description: libraryDescription.trim(),
        is_public: libraryVisibility === "public",
      });

      const updatedLibrary = {
        ...libraryData,
        name: trimmedLibraryName,
        description: libraryDescription.trim(),
        visibility: libraryVisibility,
        is_public: libraryVisibility === "public",
        documents: countUploadedFiles(libraryItems),
        updatedAt: "Updated just now",
      };

      setLibraryData(updatedLibrary);
      setLibraryName(trimmedLibraryName);
      setLibraryDescription(updatedLibrary.description);
      setLibraryNameMessage("Library settings saved successfully.");
    } catch (error) {
      console.error("Failed to save library settings:", error);
      setLibraryNameMessage("Failed to save library settings on server.");
    }
  }
  async function handleDeleteLibrary() {
    const confirmed = await showConfirm(
      "Are you sure you want to delete this library? This action cannot be undone."
    );

    if (!confirmed) return;

    try {
      await deleteLibrary(libraryData.id || libraryId);

      navigate("/dashboard/libraries", { replace: true });
    } catch (error) {
      console.error("Failed to delete library:", error);
      alert(
        error.response?.data?.message ||
          "Failed to delete this library. Please try again.",
      );
    }
  }

  async function handleRenameFolder(folder, event) {
    event?.stopPropagation();
    if (!canManageLibrary) return;

    const oldName = folder.name || "";
    const newName = await showPrompt("Enter a new name for this folder.", oldName, {
      title: "Rename folder",
      placeholder: "Folder name",
      confirmText: "Rename folder",
    });

    if (newName === null) return;

    const trimmedName = newName.trim();

    if (trimmedName === "") {
      alert("Folder name cannot be empty.");
      return;
    }

    if (normalizeFolderName(trimmedName) === normalizeFolderName(oldName)) {
      return;
    }

    const folderKey = getFolderKey(folder);
    const parentFolderId = folder.folderId ?? null;

    if (hasFolderWithSameName(trimmedName, parentFolderId, folderKey)) {
      alert("A folder with this name already exists in the same location.");
      return;
    }

    setLibraryItems((currentItems) =>
      currentItems.map((item) => {
        if (item.type === "folder" && getFolderKey(item) === folderKey) {
          return {
            ...item,
            name: trimmedName,
            note: "Renamed just now",
          };
        }

        return item;
      })
    );

    if (currentFolder && getFolderKey(currentFolder) === folderKey) {
      setCurrentFolder((currentValue) => ({
        ...currentValue,
        name: trimmedName,
        note: "Renamed just now",
      }));
    }
  }

  async function handleDeleteFolder(folder, event) {
    event.stopPropagation();
    if (!canManageLibrary) return;

    const folderKey = getFolderKey(folder);
    const confirmDelete = await showConfirm(
      `Delete folder "${folder.name}" and everything inside it?`,
    );

    if (!confirmDelete) return;

    setLibraryItems((currentItems) => {
      const folderIdsToDelete = new Set([folderKey]);
      let keepSearching = true;

      while (keepSearching) {
        keepSearching = false;

        currentItems.forEach((item) => {
          const itemParentId = item.folderId ?? null;

          if (
            item.type === "folder" &&
            itemParentId &&
            folderIdsToDelete.has(itemParentId) &&
            !folderIdsToDelete.has(getFolderKey(item))
          ) {
            folderIdsToDelete.add(getFolderKey(item));
            keepSearching = true;
          }
        });
      }

      const nextItems = currentItems.filter((item) => {
        const itemKey = item.type === "folder" ? getFolderKey(item) : null;
        const itemParentId = item.folderId ?? null;

        return (
          !folderIdsToDelete.has(itemKey) &&
          !folderIdsToDelete.has(itemParentId)
        );
      });

      syncLibraryDocumentCount(nextItems);
      return nextItems;
    });

    if (currentFolder && getFolderKey(currentFolder) === folderKey) {
      setCurrentFolder(null);
    }
  }

  function countFilesInFolder(folder) {
    const descendantFolderIds = new Set([getFolderKey(folder)]);
    let foundNestedFolder = true;

    while (foundNestedFolder) {
      foundNestedFolder = false;

      libraryItems.forEach((item) => {
        if (
          item.type === "folder" &&
          descendantFolderIds.has(item.folderId ?? null) &&
          !descendantFolderIds.has(getFolderKey(item))
        ) {
          descendantFolderIds.add(getFolderKey(item));
          foundNestedFolder = true;
        }
      });
    }

    return libraryItems.filter(
      (item) =>
        item.type !== "folder" &&
        descendantFolderIds.has(item.folderId ?? null),
    ).length;
  }

  function getFolderDetails(folder) {
    const fileCount = countFilesInFolder(folder);
    const savedDetail = String(folder.note || "Created recently")
      .split("·")
      .pop()
      .trim();

    return `${fileCount} ${fileCount === 1 ? "file" : "files"} · ${savedDetail}`;
  }


  const visibleItems = libraryItems.filter((item) => {
    const itemFolderId = item.folderId ?? null;

    if (currentFolder) {
      return itemFolderId === getFolderKey(currentFolder);
    }

    return itemFolderId === null;
  });

  const documentItems = visibleItems.filter((item) => item.type !== "folder");
  const folderItems = visibleItems.filter((item) => item.type === "folder");
  const normalizedDocumentSearch = documentSearch.trim().toLowerCase();

  const filteredDocuments = documentItems.filter((item) =>
    (item.name || "").toLowerCase().includes(normalizedDocumentSearch),
  );
  const filteredFolders = folderItems.filter((item) =>
    (item.name || "").toLowerCase().includes(normalizedDocumentSearch),
  );
  const filteredStorageItemsCount =
    filteredFolders.length + filteredDocuments.length;

  const uploadedFileCount = countUploadedFiles(libraryItems) || Number(libraryData.documents) || 0;

  const usedStorageBytes = isGuest
    ? countUsedStorageBytes(libraryItems)
    : userStorageUsedBytes;

  const usedStoragePercent = Math.min(
    (usedStorageBytes / LIBRARY_STORAGE_LIMIT_BYTES) * 100,
    100
  );

  const remainingStorageBytes = Math.max(
    LIBRARY_STORAGE_LIMIT_BYTES - usedStorageBytes,
    0
  );

  const currentLocationLabel = currentFolder ? currentFolder.name : "All subjects";
  const currentFolderPath = currentFolder ? getFolderPath(currentFolder) : [];
  const statusText = isLoadingDocuments
    ? "Syncing documents"
    : `${uploadedFileCount} files ready`;

  return (
    <main className="library_page">
      <section className="library_workspace">
        <section className="library_command_panel">
          <div className="library_command_left">
            <button
              className="library_back_btn"
              type="button"
              onClick={() => navigate("/dashboard/libraries")}
            >
              <i className="ti-angle-left"></i>
              Back to libraries
            </button>

            <div className="library_heading_block">
              <div className="library_title">
                <h1>{libraryData.name}</h1>
              </div>
            </div>
          </div>

          <div className="library_command_right">
            <div className="library_status_card">
              <div className="library_status_topline">
                <span>Current view</span>
                <span className="library_visibility_badge">
                  {formatVisibility(libraryData.visibility)}
                </span>
              </div>
              <strong>{currentLocationLabel}</strong>
              <p>{statusText}</p>
            </div>

            {!isGuest && (
              <div className="library_hero_actions">
                <button
                  className={`star_btn ${isStarred ? "active" : ""}`}
                  type="button"
                  onClick={handleToggleStar}
                >
                  <i className="ti-star"></i>
                  {isStarred ? "Starred" : "Star"}
                  {stars > 0 && <span className="star_count">{stars}</span>}
                </button>

                {canManageLibrary && (
                  <label className="upload_btn">
                    <i className="ti-upload"></i>
                    Upload
                    <input
                      type="file"
                      multiple
                      accept={ALLOWED_UPLOAD_ACCEPT}
                      onChange={handleUploadFile}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </section>

        <nav className="library_tabs" aria-label="Library sections">
          <button
            type="button"
            className={activeTab === "documents" ? "active" : ""}
            onClick={() => setActiveTab("documents")}
          >
            <i className="ti-files"></i>
            Documents
          </button>

          {canManageLibrary && (
            <button
              type="button"
              className={activeTab === "settings" ? "active" : ""}
              onClick={() => setActiveTab("settings")}
            >
              <i className="ti-settings"></i>
              Settings
            </button>
          )}
        </nav>

        <section className="library_body">
          <section className="library_main">
            {activeTab === "documents" && (
              <section className="documents_tab_panel">
                <div className="documents_tab_toolbar">
                  <div className="documents_toolbar_copy">
                    <h2>Document board</h2>
                    <p>Search files, open folders, add tags and keep uploads inside the 50MB limit.</p>
                  </div>

                  <div className="documents_toolbar_controls">
                    <label className="documents_tab_search">
                      <i className="ti-search"></i>
                      <input
                        type="text"
                        placeholder="Search file"
                        value={documentSearch}
                        onChange={(e) => setDocumentSearch(e.target.value)}
                      />
                    </label>

                    {canManageLibrary && (
                      <div className="documents_tab_actions">
                        <button
                          type="button"
                          className="documents_new_folder_btn"
                          onClick={handleCreateFolder}
                        >
                          <i className="ti-folder"></i>
                          New folder
                        </button>

                        <label className="documents_upload_btn">
                          <i className="ti-upload"></i>
                          Upload file
                          <input
                            type="file"
                            multiple
                            accept={ALLOWED_UPLOAD_ACCEPT}
                            onChange={handleUploadFile}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                <nav
                  className="documents_breadcrumb"
                  aria-label="Current folder path"
                >
                  <button
                    type="button"
                    className={!currentFolder ? "active" : ""}
                    onClick={handleBackToLibrary}
                  >
                    <LuLibraryBig aria-hidden="true" />
                    {libraryName || libraryData.name || "Library"}
                  </button>

                  {currentFolderPath.map((folder, index) => {
                    const isCurrentFolder =
                      index === currentFolderPath.length - 1;

                    return (
                      <span
                        className="breadcrumb_item"
                        key={getFolderKey(folder)}
                      >
                        <i className="ti-angle-right" aria-hidden="true"></i>
                        {isCurrentFolder ? (
                          <strong aria-current="page">{folder.name}</strong>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenBreadcrumbFolder(folder)
                            }
                          >
                            <i className="ti-folder"></i>
                            {folder.name}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </nav>

                {isLoadingDocuments ? (
                  <div className="empty_state_card loading_state_card">
                    <div className="empty_state_icon">
                      <i className="ti-reload"></i>
                    </div>
                    <h3>Loading documents</h3>
                    <p>Please wait while we load your files.</p>
                  </div>
                ) : visibleItems.length === 0 ? (
                  <div className="empty_state_card">
                    <div className="empty_state_icon">
                      <i className="ti-folder"></i>
                    </div>
                    <h3>{currentFolder ? "This folder is empty" : "This library is empty"}</h3>
                    <p>
                      {canManageLibrary
                        ? "Add your first document to start building this study library."
                        : "The owner has not added any documents yet."}
                    </p>
                    {canManageLibrary && (
                      <label className="empty_state_action">
                        <i className="ti-upload"></i>
                        Upload file
                        <input
                          type="file"
                          multiple
                          accept={ALLOWED_UPLOAD_ACCEPT}
                          onChange={handleUploadFile}
                        />
                      </label>
                    )}
                  </div>
                ) : documentSearch && filteredStorageItemsCount === 0 ? (
                  <div className="empty_state_card">
                    <div className="empty_state_icon">
                      <i className="ti-search"></i>
                    </div>
                    <h3>No documents found</h3>
                    <p>
                      {canManageLibrary
                        ? "Try another keyword or upload a new document."
                        : "Try another keyword."}
                    </p>
                    {canManageLibrary && (
                      <label className="empty_state_action">
                        <i className="ti-upload"></i>
                        Upload file
                        <input
                          type="file"
                          multiple
                          accept={ALLOWED_UPLOAD_ACCEPT}
                          onChange={handleUploadFile}
                        />
                      </label>
                    )}
                  </div>
                ) : filteredStorageItemsCount > 0 ? (
                  <section className="documents_table_card storage_table_card">
                    <header className="storage_table_title">
                      <div>
                        {currentFolder && (
                          <button type="button" onClick={handleBackToLibrary}>
                            <i className="ti-angle-left"></i>
                          </button>
                        )}
                        <div>
                          <h3>Storage</h3>
                          <p>
                            {currentFolder
                              ? currentFolder.name
                              : "Folders and uploaded files"}
                          </p>
                        </div>
                      </div>
                      <span>{filteredStorageItemsCount} items</span>
                    </header>

                    <div className="documents_table_header">
                      <span>Item</span>
                      <span>Size</span>
                      <span>Uploaded / Details</span>
                      <span>Actions</span>
                    </div>

                    <div className="documents_table_body">
                      {filteredFolders.map((folder) => (
                        <div
                          className="documents_table_row storage_folder_row"
                          key={getFolderKey(folder)}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenFolder(folder)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleOpenFolder(folder);
                            }
                          }}
                        >
                          <div className="document_file_name">
                            <div className="document_icon_shell storage_folder_icon">
                              <i className="ti-folder"></i>
                            </div>
                            <div className="document_name_with_tags">
                              <span>{folder.name}</span>
                              <small>Folder</small>
                            </div>
                          </div>

                          <div className="document_size">Folder</div>

                          <div className="document_uploaded">
                            <strong>{getFolderDetails(folder)}</strong>
                            <span>Open to view contents</span>
                          </div>

                          <div className="document_actions">
                            <button
                              type="button"
                              title="Open folder"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenFolder(folder);
                              }}
                            >
                              <i className="ti-folder"></i>
                            </button>

                            {canManageLibrary && (
                              <>
                                <button
                                  type="button"
                                  title="Rename folder"
                                  onClick={(event) => handleRenameFolder(folder, event)}
                                >
                                  <i className="ti-pencil-alt"></i>
                                </button>

                                <button
                                  type="button"
                                  className="delete_document_btn"
                                  title="Delete folder"
                                  onClick={(event) => handleDeleteFolder(folder, event)}
                                >
                                  <i className="ti-trash"></i>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}

                      {filteredDocuments.map((document) => (
                        <div
                          className="documents_table_row"
                          key={document.id || `${document.name}-${document.uploadedTime || ""}`}
                        >
                          <div className="document_file_name">
                            <div className="document_icon_shell document_file_type_icon">
                              {renderFileIcon(document.name)}
                            </div>

                            <div className="document_name_with_tags">
                              <span>{formatDisplayFileName(document.name)}</span>

                              {document.hashtags?.length > 0 && (
                                <div className="document_tags">
                                  {document.hashtags.map((tag) => (
                                    <small key={tag}>{tag}</small>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="document_size">
                            {document.size || document.note?.split("·")[0]?.trim() || "Unknown"}
                          </div>

                          <div className="document_uploaded">
                            <strong>
                              {document.uploadedTime ||
                                document.note?.split("·")[1]?.trim() ||
                                "Recently"}
                            </strong>
                            <span>by {document.uploadedBy || "dangkhoabi456"}</span>
                          </div>

                          <div className="document_actions">
                            <button
                              type="button"
                              title="View"
                              onClick={() => handleViewDocument(document)}
                            >
                              <i className="ti-eye"></i>
                            </button>

                            <button
                              type="button"
                              title="Download"
                              onClick={() => handleDownloadDocument(document)}
                            >
                              <i className="ti-download"></i>
                            </button>

                            {canManageLibrary && (
                              <button
                                type="button"
                                className="delete_document_btn"
                                title="Delete"
                                onClick={() => handleDeleteDocument(document)}
                              >
                                <i className="ti-trash"></i>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="empty_state_card">
                    <div className="empty_state_icon">
                      <i className="ti-folder"></i>
                    </div>
                    <h3>{currentFolder ? "This folder is empty" : "Your storage is empty"}</h3>
                    <p>Add a folder or upload a document to get started.</p>
                  </div>
                )}
              </section>
            )}

            {canManageLibrary && activeTab === "settings" && (
              <section className="settings_tab_panel">
                <div className="settings_header">
                  <h2>Library settings</h2>
                  <p>Manage naming, privacy, profile visibility and library removal.</p>
                </div>

                <form className="settings_general_card" onSubmit={handleSaveSettings}>
                  <div className="settings_card_title">
                    <div className="settings_card_icon">
                      <i className="ti-write"></i>
                    </div>

                    <div>
                      <h3>General information</h3>
                      <p>Keep this library clear and easy to identify.</p>
                    </div>
                  </div>

                  <div className="settings_form_group">
                    <label htmlFor="libraryName">Library name</label>
                    <input
                      id="libraryName"
                      type="text"
                      value={libraryName}
                      onChange={handleLibraryNameChange}
                    />

                    <div className="settings_helper_row">
                      <small>{libraryName.length}/{LIBRARY_NAME_MAX_LENGTH} characters</small>
                      {libraryNameMessage && (
                        <small className="settings_warning_text">{libraryNameMessage}</small>
                      )}
                    </div>
                  </div>

                  <div className="settings_form_group">
                    <label>Publishing</label>

                    <label className={`settings_publish_control ${libraryVisibility === "public" ? "is_enabled" : ""}`}>
                      <span>
                        <strong>Allow publish</strong>
                        <small>
                          {libraryData?.is_public === true
                            ? "Published libraries cannot be made private again."
                            : "Publish this library so it can appear in Discover and search."}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={libraryVisibility === "public"}
                        disabled={libraryData?.is_public === true}
                        onChange={(event) => {
                          setLibraryVisibility(event.target.checked ? "public" : "private");
                          setLibraryNameMessage("");
                        }}
                      />
                      <span className="settings_publish_switch" aria-hidden="true"><i /></span>
                    </label>
                  </div>

                </form>

                <div className="settings_save_bar">
                  <span>Save updates to local library data.</span>
                  <button type="button" onClick={handleSaveSettings}>
                    Save changes
                  </button>
                </div>

                <section className="danger_zone_card">
                  <div className="danger_zone_intro">
                    <div>
                      <h3>Danger zone</h3>
                      <p>Deleting this library removes it from saved and recent libraries.</p>
                    </div>
                    <i className="ti-alert"></i>
                  </div>

                  <div className="danger_zone_action">
                    <div>
                      <strong>Delete library</strong>
                      <p>This action cannot be undone.</p>
                    </div>

                    <button
                      type="button"
                      className="delete_library_button"
                      onClick={handleDeleteLibrary}
                    >
                      Delete library
                    </button>
                  </div>
                </section>
              </section>
            )}
          </section>

          <aside className="library_sidebar">
            {isLibraryOwner && <div className="capacity_card">
              <div className="storage_card_header">
                <div className="storage_card_icon">
                  <i className="ti-harddrive"></i>
                </div>

                <div>
                  <h3>Library storage</h3>
                  <p>Storage used by uploaded files</p>
                </div>
              </div>

              <div className="storage_usage_line">
                <span>Storage limit</span>
                <strong>
                  {formatFileSize(usedStorageBytes)} / {formatFileSize(LIBRARY_STORAGE_LIMIT_BYTES)}
                </strong>
              </div>

              <div className="capacity_bar">
                <div style={{ width: `${usedStoragePercent}%` }}></div>
              </div>

              <div className="storage_stats">
                <div>
                  <strong>{formatFileSize(usedStorageBytes)}</strong>
                  <span>Used</span>
                </div>

                <div>
                  <strong>{formatFileSize(remainingStorageBytes)}</strong>
                  <span>Remaining</span>
                </div>
              </div>
            </div>}

            <div className="side_card">
              <div className="side_title">
                <h3>Owner</h3>
              </div>

              <div className="collaborator_item">
                <div className="collaborator_icon">
                  <i className="ti-user"></i>
                </div>

                <div>
                  <strong>{ownerDisplayName}</strong>
                  <p>Library owner</p>
                </div>
              </div>
            </div>

            <div className="side_card library_info_card">
              <h3>Library info</h3>

              <div className="info_row">
                <span>Files uploaded</span>
                <strong>{uploadedFileCount}</strong>
              </div>

              <div className="info_row">
                <span>Stars</span>
                <strong>{stars}</strong>
              </div>

            </div>

            <div className="summarize_card">
              <h3>Library access</h3>
              <p>Download the full library as ZIP or share access with others.</p>
              <div className="library_access_actions">
                <button
                  type="button"
                  onClick={handleDownloadLibrary}
                  disabled={isExportingLibrary}
                >
                  <i className="ti-download"></i>
                  {isExportingLibrary ? "Preparing..." : "Download"}
                </button>
                <button
                  type="button"
                  className="library_import_button"
                  onClick={handleShareLibrary}
                >
                  <i className="ti-share"></i>
                  Share
                </button>
              </div>
            </div>
          </aside>
        </section>

        {activeTab === "documents" && (
          <section className="library_readme_card">
            <header className="library_readme_header">
              <div>
                <i className="ti-book"></i>
                <strong>Description</strong>
              </div>
            </header>

            <div className="library_readme_content">
              <textarea
                value={libraryDescription}
                onChange={(event) => setLibraryDescription(event.target.value)}
                placeholder="Write a short description for this library..."
                aria-label="Library description"
                readOnly={!canManageLibrary}
                disabled={!canManageLibrary}
              />

              {canManageLibrary && (
                <div className="library_description_actions">
                  <small>{libraryDescription.length} characters</small>
                  <button type="button" onClick={handleSaveSettings}>
                    Save description
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </section>

      {isShareModalOpen && (
        <div
          className="library_share_modal_overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsShareModalOpen(false);
            }
          }}
        >
          <div
            className="library_share_modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-share-title"
          >
            <header>
              <h2 id="library-share-title">Share library</h2>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                aria-label="Close share dialog"
              >
                ×
              </button>
            </header>
            <div className="library_share_link_row">
              <input
                type="url"
                value={window.location.href}
                readOnly
                aria-label="Library share URL"
                onFocus={(event) => event.target.select()}
              />
              <button type="button" onClick={handleCopyShareLink}>
                <i className={isShareLinkCopied ? "ti-check" : "ti-link"}></i>
                {isShareLinkCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadNotice && (
        <div
          className={`library_upload_notice is_${uploadNotice.type}`}
          role={uploadNotice.type === "error" ? "alert" : "status"}
          aria-live={uploadNotice.type === "error" ? "assertive" : "polite"}
        >
          <span className="library_upload_notice_icon">
            <i
              className={
                uploadNotice.type === "success" ? "ti-check" : "ti-alert"
              }
            ></i>
          </span>
          <div>
            <strong>
              {uploadNotice.title ||
                (uploadNotice.type === "success"
                  ? "Upload complete"
                  : "Upload needs review")}
            </strong>
            <p>{uploadNotice.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setUploadNotice(null)}
            aria-label="Close upload message"
          >
            ×
          </button>
        </div>
      )}

      {isTagModalOpen && (
        <div className="hashtag_modal_overlay">
          <div className="hashtag_modal">
            <div className="hashtag_modal_header">
              <div>
                <h2>Add tags to your document</h2>
                <p>Provide 1-3 hashtags (format: #(noun) e.g., #grade12, #math) to categorize your file.</p>
              </div>

              <button type="button" onClick={handleCancelTaggedUpload}>
                ×
              </button>
            </div>

            <div className="hashtag_modal_body">
              <section className="tag_generator_panel" aria-label="AI tag generator">
                <div>
                  <strong>Need help choosing tags?</strong>
                  <p>
                    Generate optional suggestions, then choose which ones to use.
                    Your manual tags will not be replaced.
                  </p>
                </div>
                <button
                  type="button"
                  className="generate_tags_btn"
                  onClick={() => loadAiRecommendedTags(pendingFiles)}
                  disabled={
                    pendingFiles.length === 0 ||
                    isLoadingAiTags ||
                    isAiTagRateLimited ||
                    isUploadingDocuments
                  }
                >
                  {isLoadingAiTags
                    ? "Generating..."
                    : isAiTagRateLimited
                      ? "AI limit reached — please wait"
                      : "Generate tags with AI"}
                </button>
              </section>

              <div className="hashtag_input_list">
                {hashtags.map((tag, index) => {
                  const userTagNormalized = tag.trim().toLowerCase().replace("#", "");
                  const tagError = tagErrors.find(v => {
                    const apiTagNormalized = (v.tag || "").trim().toLowerCase().replace("#", "");
                    return userTagNormalized && userTagNormalized === apiTagNormalized && !v.isValid;
                  });
                  const tagInputError = tagInputErrors[index];

                  return (
                    <div
                      key={index}
                      className={`hashtag_input_wrapper ${
                        activeHashtagIndex === index ? "is_active" : ""
                      }`}
                    >
                      <input
                        ref={(element) => {
                          hashtagInputRefs.current[index] = element;
                        }}
                        type="text"
                        value={tag}
                        onFocus={() => setActiveHashtagIndex(index)}
                        onClick={() => setActiveHashtagIndex(index)}
                        onChange={(e) => {
                          handleHashtagChange(index, e.target.value);
                        }}
                        placeholder={`# tag${index + 1}`}
                        className={
                          tagError || tagInputError ? "input_has_error" : ""
                        }
                        aria-invalid={Boolean(tagError || tagInputError)}
                      />
                      {tagInputError && (
                        <div className="tag_error_message tag_input_error_message">
                          <i className="ti-alert" aria-hidden="true"></i>
                          <span>{tagInputError}</span>
                        </div>
                      )}
                      {tagError && (
                        <div className="tag_error_message">
                          <span className="error_icon">⚠️</span>
                          <span>
                            AI suggestion:{" "}
                            <button
                              type="button"
                              className="apply_recommendation_btn"
                              disabled={isUploadingDocuments}
                              onClick={() => {
                                if (isUploadingDocuments) return;
                                handleHashtagChange(index, tagError.recommendedReplacement);
                                setTagErrors([]);
                              }}
                            >
                              {tagError.recommendedReplacement}
                            </button>
                            {" - "}
                            {tagError.reason}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="ai_recommended_tags_section">
                <div className="ai_recommended_tags_header">
                  <strong>AI suggestions:</strong>
                  {aiRecommendedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={handleApplyAllSuggestedTags}
                      disabled={isUploadingDocuments}
                    >
                      Apply suggestions
                    </button>
                  )}
                </div>
                {isLoadingAiTags ? (
                  <span className="ai_tags_loading">AI is analyzing the document and suggesting tags...</span>
                ) : aiRecommendedTags.length > 0 ? (
                  <div className="ai_tags_chips">
                    {aiRecommendedTags.map((recTag) => (
                      <button
                        key={recTag}
                        type="button"
                        className="ai_tag_chip"
                        disabled={isUploadingDocuments}
                        onClick={() => {
                          if (isUploadingDocuments) return;
                          const targetIndex = Number.isInteger(activeHashtagIndex)
                            ? activeHashtagIndex
                            : Math.max(0, hashtags.findIndex((tag) => !tag.trim()));
                          handleHashtagChange(targetIndex, recTag);
                          setTagErrors([]);
                          window.requestAnimationFrame(() => {
                            hashtagInputRefs.current[targetIndex]?.focus();
                          });
                        }}
                      >
                        {recTag}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ai_tags_error">
                    <span>{aiTagSuggestionError || "Generate tags when you want AI suggestions."}</span>
                    {aiTagSuggestionError && pendingFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => loadAiRecommendedTags(pendingFiles)}
                        disabled={isUploadingDocuments || isAiTagRateLimited}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
              </div>

              {pendingFiles.length > 0 && (
                <div className="pending_file_preview">
                  <strong>Selected file</strong>
                  <span>
                    {pendingFiles.length === 1
                      ? pendingFiles[0].name
                      : `${pendingFiles.length} files selected`}
                  </span>
                </div>
              )}
            </div>

            <div className="hashtag_modal_actions">
              <button
                type="button"
                className="hashtag_cancel_btn"
                onClick={handleCancelTaggedUpload}
                disabled={isUploadingDocuments}
              >
                Cancel
              </button>

              <button
                type="button"
                className="hashtag_save_btn"
                onClick={handleConfirmTaggedUpload}
                disabled={isUploadingDocuments}
              >
                {isUploadingDocuments
                  ? uploadProgress < 100
                    ? `Uploading ${uploadProgress}%`
                    : "Processing document"
                  : "Save and upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {documentPendingDelete && (
        <div
          className="library_confirm_overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingDocument) {
              setDocumentPendingDelete(null);
            }
          }}
        >
          <section
            className="library_confirm_modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-document-title"
            aria-describedby="delete-document-description"
          >
            <span className="library_confirm_icon" aria-hidden="true">
              <i className="ti-trash"></i>
            </span>
            <div className="library_confirm_content">
              <h2 id="delete-document-title">Delete document?</h2>
              <p id="delete-document-description">
                You’re about to permanently delete
                <strong> “{formatDisplayFileName(documentPendingDelete.name)}”</strong>.
                This action cannot be undone.
              </p>
            </div>
            <div className="library_confirm_actions">
              <button
                type="button"
                className="library_confirm_cancel"
                disabled={isDeletingDocument}
                onClick={() => setDocumentPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="library_confirm_delete"
                disabled={isDeletingDocument}
                onClick={handleConfirmDeleteDocument}
              >
                {isDeletingDocument ? "Deleting..." : "Delete document"}
              </button>
            </div>
          </section>
        </div>
      )}

      {isStorageLimitPopupOpen && (
        <div className="storage_limit_overlay">
          <div className="storage_limit_modal">
            <div className="storage_limit_icon">
              <i className="ti-alert"></i>
            </div>

            <h2>Storage limit reached</h2>
            <p>
              This library has reached the 50MB upload limit. Delete some files before uploading more documents.
            </p>

            <div className="storage_limit_info">
              <span>Current usage</span>
              <strong>
                {formatFileSize(usedStorageBytes)} / {formatFileSize(LIBRARY_STORAGE_LIMIT_BYTES)}
              </strong>
            </div>

            <button type="button" onClick={() => setIsStorageLimitPopupOpen(false)}>
              I understand
            </button>
          </div>
        </div>
      )}

      {duplicateConfirm && (
        <div
          className="duplicate_confirm_overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDuplicateConfirmation(false);
            }
          }}
        >
          <section
            className="duplicate_confirm_modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="duplicate-confirm-title"
            aria-describedby="duplicate-confirm-description"
          >
            <div className="duplicate_confirm_icon" aria-hidden="true">
              <i className="ti-files"></i>
            </div>
            <div className="duplicate_confirm_content">
              <span className="duplicate_confirm_eyebrow">Duplicate document</span>
              <h2 id="duplicate-confirm-title">This file already exists</h2>
              <p id="duplicate-confirm-description">
                {duplicateConfirm.fileNames.length === 1 ? (
                  <><strong>“{duplicateConfirm.fileNames[0]}”</strong> has already been uploaded to this library.</>
                ) : (
                  <><strong>{duplicateConfirm.fileNames.length} selected files</strong> have already been uploaded to this library.</>
                )}
              </p>
              <p className="duplicate_confirm_hint">
                Replacing will update the existing document with the newly selected file.
              </p>
            </div>
            <div className="duplicate_confirm_actions">
              <button
                type="button"
                className="duplicate_keep_button"
                disabled={isUploadingDocuments}
                onClick={() => closeDuplicateConfirmation(false)}
              >
                Keep current
              </button>
              <button
                type="button"
                className="duplicate_replace_button"
                disabled={isUploadingDocuments}
                autoFocus
                onClick={() => closeDuplicateConfirmation(true)}
              >
                {isUploadingDocuments ? (
                  <>
                    <FaRotate className="spin" aria-hidden="true" />
                    Replacing...
                  </>
                ) : (
                  <>
                    <FaRotate aria-hidden="true" />
                    Replace document
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
      <ActionPopup popup={actionPopup} onResolve={resolveActionPopup} />
    </main>
  );

}


export default LibraryPage;
