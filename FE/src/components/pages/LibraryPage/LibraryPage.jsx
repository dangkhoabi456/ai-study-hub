import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LuLibraryBig } from "react-icons/lu";
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
  uploadDocuments,
  suggestDocumentTags,
  downloadDocument,
  deleteDocument,
  getLibrary,
  updateLibrary,
  deleteLibrary,
} from "../../../utils/documentApi";
import {
  getAccessToken,
  getStoredUser,
  isTokenValid,
} from "../../../utils/authToken";
import {
  downloadPublicDocument,
  getPublicLibrary,
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

  function handleToggleShareOnProfile() {
    if (libraryVisibility === "private") {
      setLibraryNameMessage(
        "Cannot upload to your personal profile when the library is private."
      );
      return;
    }

    setLibraryNameMessage("");
    setShareOnProfile((currentValue) => !currentValue);
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
        visibility: routeLibrary.visibility || "public",
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
  const authorName = "You";
  const [libraryData, setLibraryData] = useState(getInitialLibraryData);
  const [stars, setStars] = useState(() => Number(getInitialLibraryData().stars) || 0);

  const [isStarred, setIsStarred] = useState(
    () => Boolean(getInitialLibraryData().isStarred)
  );
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
  const [pendingFolderId, setPendingFolderId] = useState(null);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [hashtags, setHashtags] = useState(["", "", ""]);
  const [tagErrors, setTagErrors] = useState([]);
  const [tagInputErrors, setTagInputErrors] = useState(["", "", ""]);
  const [aiRecommendedTags, setAiRecommendedTags] = useState([]);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);
  const [aiTagSuggestionError, setAiTagSuggestionError] = useState("");
  const aiTagRequestIdRef = useRef(0);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isShareLinkCopied, setIsShareLinkCopied] = useState(false);

  const [libraryItems, setLibraryItems] = useState(readStoredLibraryItems);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const hasFinishedInitialDocumentLoadRef = useRef(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [isExportingLibrary, setIsExportingLibrary] = useState(false);

  const [shareOnProfile, setShareOnProfile] = useState(
    () => getInitialLibraryData().shareOnProfile ?? false
  );

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
        shareOnProfile,
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

      for (const item of libraryItems.filter((entry) => entry.type !== "folder")) {
        const fileName = sanitizeArchiveName(item.name, "document");
        const folderPath = getArchiveFolderPath(item.folderId);
        const targetFolder = folderPath
          ? filesFolder.folder(folderPath)
          : filesFolder;

        if (!item.isBackendFile || !item.id) {
          failedFiles.push(`${item.name}: file content is not available from backend`);
          continue;
        }

        try {
          const downloadData = await downloadDocument(item.id);
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

  function handleToggleStar() {
    const nextIsStarred = !isStarred;
    const nextStars = nextIsStarred ? stars + 1 : Math.max(stars - 1, 0);

    const updatedLibrary = {
      ...libraryData,
      stars: nextStars,
      isStarred: nextIsStarred,
    };

    setStars(nextStars);
    setIsStarred(nextIsStarred);
    setLibraryData(updatedLibrary);
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
      shareOnProfile: shareOnProfile,
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

  function mapBackendDocumentToLibraryItem(document) {
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
      uploadedBy: authorName,
      icon: null,
      folderId: null,
      hashtags: apiTags,
      isBackendFile: true,
    };
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
        setShareOnProfile(false);
        setLibraryItems(
          (publicLibrary.documents || []).map((document) => ({
            ...mapBackendDocumentToLibraryItem(document),
            isPublicFile: true,
          })),
        );
        return;
      }
      let currentLibData = libraryData;
      if (!isGuest) {
        if (!currentLibData || currentLibData.id === "default-library" || currentLibData.id !== libraryId) {
          try {
            const lib = await getLibrary(libraryId);
            if (lib) {
              currentLibData = {
                id: lib.id,
                name: lib.name,
                description: lib.description || "",
                visibility: lib.is_public ? "public" : "private",
                shareOnProfile: lib.share_on_profile ?? false,
                updatedAt: lib.updated_at ? new Date(lib.updated_at).toLocaleString() : "Updated just now",
                icon: "ti-archive",
              };
              setLibraryData(currentLibData);
              setLibraryName(currentLibData.name);
              setLibraryDescription(currentLibData.description);
              setLibraryVisibility(currentLibData.visibility);
              setShareOnProfile(currentLibData.shareOnProfile);
            }
          } catch (err) {
            console.error("Failed to load library metadata from backend:", err);
          }
        }
      }
      const activeLibraryId = String(currentLibData?.id || libraryId || "");
      const accessToken = getAccessToken();

      if (!isTokenValid(accessToken)) {
        return;
      }

      const backendDocuments = await getMyDocuments(activeLibraryId);
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

    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function loadAiRecommendedTags(files) {
    const requestId = ++aiTagRequestIdRef.current;
    setAiRecommendedTags([]);
    setAiTagSuggestionError("");
    setIsLoadingAiTags(true);

    try {
      const recommendedTags = await suggestDocumentTags(files);
      if (requestId === aiTagRequestIdRef.current) {
        setAiRecommendedTags(recommendedTags);
        if (recommendedTags.length === 0) {
          setAiTagSuggestionError("AI could not find suitable tags. You can try again.");
        }
      }
    } catch (error) {
      console.error("Cannot load AI tag suggestions:", error);
      if (requestId === aiTagRequestIdRef.current) {
        setAiRecommendedTags([]);
        setAiTagSuggestionError("Unable to load AI suggestions. Please try again.");
      }
    } finally {
      if (requestId === aiTagRequestIdRef.current) {
        setIsLoadingAiTags(false);
      }
    }
  }

  function handleUploadFile(e) {
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
      alert(
        `Only PDF, DOCX, and TXT files are allowed:\n- ${unsupportedFiles.join(
          "\n- ",
        )}\n\nPlease convert old DOC files to DOCX before uploading.`,
      );
    }

    if (tooLargeFiles.length > 0) {
      alert(`These files exceed 50MB limit:\n- ${tooLargeFiles.join("\n- ")}`);
    }

    if (validFiles.length === 0) {
      e.target.value = "";
      return;
    }

    const selectedFilesSize = validFiles.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0
    );

    const currentUsedStorage = countUsedStorageBytes(libraryItems);
    const nextUsedStorage = currentUsedStorage + selectedFilesSize;

    if (nextUsedStorage > LIBRARY_STORAGE_LIMIT_BYTES) {
      setIsStorageLimitPopupOpen(true);
      e.target.value = "";
      return;
    }

    setPendingFiles(validFiles);
    setPendingFolderId(currentFolder ? getFolderKey(currentFolder) : null);
    setHashtags(["", "", ""]);
    setIsTagModalOpen(true);
    loadAiRecommendedTags(validFiles);

    e.target.value = "";
    generateTagsAutomatically(validFiles[0]);
  }

  async function generateTagsAutomatically(file) {
    if (!file) return;
    try {
      setIsGeneratingTags(true);
      setAiRecommendedTags([]);
      
      const formData = new FormData();
      formData.append("file", file);

      const response = await api.post("/documents/suggest-tags", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      if (response.data?.status === "success" && Array.isArray(response.data?.tags)) {
        const tags = response.data.tags;
        setAiRecommendedTags(tags);
        
        // Auto-fill the 3 hashtags inputs
        const autoFilled = ["", "", ""];
        tags.slice(0, 3).forEach((tag, idx) => {
          autoFilled[idx] = tag;
        });
        setHashtags(autoFilled);
      }
    } catch (error) {
      console.error("Failed to generate tags:", error);
    } finally {
      setIsGeneratingTags(false);
    }
  }

  function handleHashtagChange(index, value) {
    const updatedHashtags = [...hashtags];
    updatedHashtags[index] = value;
    setHashtags(updatedHashtags);
    setTagInputErrors(["", "", ""]);
  }

  function handleCancelTaggedUpload() {
    aiTagRequestIdRef.current += 1;
    setPendingFiles([]);
    setPendingFolderId(null);
    setHashtags(["", "", ""]);
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

      const workspaceId = libraryData?.workspaceId || libraryData?.workspace_id;
      const uploadedDocuments = await uploadDocuments(
        pendingFiles, 
        workspaceId, 
        libraryData.id || libraryId,
        validHashtags
      );
      
      const uploadedItems = (uploadedDocuments || []).map((document, index) => ({
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
      }));

      setLibraryItems((currentItems) => {
        const nextItems = [...uploadedItems, ...currentItems];
        syncLibraryDocumentCount(nextItems);
        return nextItems;
      });

      handleCancelTaggedUpload();

      const hasFlagged = (uploadedDocuments || []).some(doc => doc.status === "FLAGGED");
      if (hasFlagged) {
        setUploadNotice({
          type: "warning",
          message:
            "Upload completed, but sensitive documents were sent to Admin for review.",
        });
      } else {
        setUploadNotice({
          type: "success",
          message:
            uploadedItems.length === 1
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
    }
  }

  function handleCreateFolder() {
    const folderName = window.prompt("Enter folder name:");

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

  async function handleDeleteDocument(fileItem) {
    if (!window.confirm(`Delete "${formatDisplayFileName(fileItem.name)}"?`)) return;

    try {
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

      alert("Document deleted successfully.");
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Delete failed. Please try again.");
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

      const data = isGuest
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
        share_on_profile: shareOnProfile,
      });

      const updatedLibrary = {
        ...libraryData,
        name: trimmedLibraryName,
        description: libraryDescription.trim(),
        visibility: libraryVisibility,
        shareOnProfile: shareOnProfile,
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
    const confirmed = window.confirm(
      "Are you sure you want to delete this library? This action cannot be undone."
    );

    if (!confirmed) return;

    try {
      await deleteLibrary(libraryData.id || libraryId);

      navigate("/dashboard/libraries", { replace: true });
    } catch (error) {
      console.error("Failed to delete library:", error);
      alert("Failed to delete this library. Please try again.");
    }
  }

  function handleRenameFolder(folder, event) {
    event?.stopPropagation();

    const oldName = folder.name || "";
    const newName = window.prompt("Enter new folder name:", oldName);

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

  function handleDeleteFolder(folder, event) {
    event.stopPropagation();

    const folderKey = getFolderKey(folder);
    const confirmDelete = window.confirm(
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

  const usedStorageBytes = countUsedStorageBytes(libraryItems);

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

          {!isGuest && (
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

                    {!isGuest && (
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
                    <h3>{currentFolder ? "This folder is empty" : "Your library is empty"}</h3>
                    <p>Add your first document to start building this study library.</p>
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
                  </div>
                ) : documentSearch && filteredStorageItemsCount === 0 ? (
                  <div className="empty_state_card">
                    <div className="empty_state_icon">
                      <i className="ti-search"></i>
                    </div>
                    <h3>No documents found</h3>
                    <p>Try another keyword or upload a new document.</p>
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

                            {!isGuest && (
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

            {!isGuest && activeTab === "settings" && (
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
                    <label>Privacy and visibility</label>

                    <div className="settings_visibility_options">
                      <label
                        className={`settings_visibility_card ${libraryVisibility === "public" ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="libraryVisibility"
                          value="public"
                          checked={libraryVisibility === "public"}
                          onChange={(e) => {
                            setLibraryVisibility(e.target.value);
                            setLibraryNameMessage("");
                          }}
                        />

                        <div>
                          <h4>Public</h4>
                          <p>Visible to members and searchable inside the study hub.</p>
                        </div>
                      </label>

                      <label
                        className={`settings_visibility_card ${libraryVisibility === "private" ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="libraryVisibility"
                          value="private"
                          checked={libraryVisibility === "private"}
                          onChange={(e) => {
                            setLibraryVisibility(e.target.value);
                            setShareOnProfile(false);
                            setLibraryNameMessage("");
                          }}
                        />

                        <div>
                          <h4>Private</h4>
                          <p>Only visible to you and invited collaborators.</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="settings_profile_visibility">
                    <div>
                      <label>Profile visibility</label>
                      <p>Show this library on your personal profile.</p>
                      <small>Private libraries cannot be shown on profile.</small>
                    </div>

                    <button
                      type="button"
                      className={`settings_toggle_btn ${shareOnProfile ? "active" : ""}`}
                      onClick={handleToggleShareOnProfile}
                      aria-label="Toggle library visibility on profile"
                    >
                      <span></span>
                    </button>
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
            <div className="capacity_card">
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
            </div>

            <div className="side_card">
              <div className="side_title">
                <h3>Owner</h3>
              </div>

              <div className="collaborator_item">
                <div className="collaborator_icon">
                  <i className="ti-user"></i>
                </div>

                <div>
                  <strong>{authorName}</strong>
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

              <div className="info_row">
                <span>Profile visibility</span>
                <strong>{shareOnProfile ? "Shown" : "Hidden"}</strong>
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
              />

              <div className="library_description_actions">
                <small>{libraryDescription.length} characters</small>
                <button type="button" onClick={handleSaveSettings}>
                  Save description
                </button>
              </div>
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
            aria-label="Close upload notification"
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
              <div className="hashtag_input_list">
                {hashtags.map((tag, index) => {
                  const userTagNormalized = tag.trim().toLowerCase().replace("#", "");
                  const tagError = tagErrors.find(v => {
                    const apiTagNormalized = (v.tag || "").trim().toLowerCase().replace("#", "");
                    return userTagNormalized && userTagNormalized === apiTagNormalized && !v.isValid;
                  });
                  const tagInputError = tagInputErrors[index];

                  return (
                    <div key={index} className="hashtag_input_wrapper">
                      <input
                        type="text"
                        value={tag}
                        onChange={(e) => {
                          handleHashtagChange(index, e.target.value);
                          setTagErrors([]);
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
                <strong>AI suggestions:</strong>
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
                          const emptyIndex = hashtags.findIndex(h => h.trim() === "");
                          if (emptyIndex !== -1) {
                            handleHashtagChange(emptyIndex, recTag);
                          } else {
                            handleHashtagChange(2, recTag);
                          }
                        }}
                      >
                        {recTag}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ai_tags_error">
                    <span>{aiTagSuggestionError || "AI is preparing tag suggestions..."}</span>
                    {aiTagSuggestionError && pendingFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => loadAiRecommendedTags(pendingFiles)}
                        disabled={isUploadingDocuments}
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
                {isUploadingDocuments ? "Uploading" : "Save and upload"}
              </button>
            </div>
          </div>
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
    </main>
  );

}


export default LibraryPage;
