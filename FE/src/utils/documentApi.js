import api from "./api";

export async function getMyDocuments(libraryId = null) {
  const params = {};
  if (libraryId) {
    params.libraryId = libraryId;
  }
  const response = await api.get("/documents", { params });
  return response.data.data;
}

export async function uploadDocuments(
  files,
  workspaceId = null,
  libraryId = null,
  tags = [],
  onProgress = null,
) {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append("files", file);
  });

  if (workspaceId) {
    formData.append("workspaceId", workspaceId);
  }
  
  if (libraryId) {
    formData.append("libraryId", libraryId);
  }

  if (tags && tags.length > 0) {
    formData.append("tags", JSON.stringify(tags));
  }

  const response = await api.post("/documents/upload", formData, {
    onUploadProgress: (event) => {
      if (typeof onProgress !== "function") return;

      const progress = Number.isFinite(event.progress)
        ? event.progress
        : event.total
          ? event.loaded / event.total
          : 0;

      onProgress(Math.min(100, Math.round(progress * 100)));
    },
  });

  return response.data.data;
}

export async function suggestDocumentTags(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post("/documents/suggest-tags", formData);
  return Array.isArray(response.data?.data?.tags)
    ? response.data.data.tags
    : [];
}

export async function downloadDocument(documentId) {
  const response = await api.get(`/documents/${documentId}/download`);
  return response.data.data;
}

export async function deleteDocument(documentId) {
  const response = await api.delete(`/documents/${documentId}`);
  return response.data;
}

export async function getMyLibraries() {
  const response = await api.get("/documents/libraries");
  return response.data.data;
}

export async function createLibrary(payload) {
  const response = await api.post("/documents/libraries", payload);
  return response.data.data;
}

export async function updateLibrary(libraryId, payload) {
  const response = await api.put(`/documents/libraries/${libraryId}`, payload);
  return response.data.data;
}

export async function getLibrary(libraryId) {
  const response = await api.get(`/documents/libraries/${libraryId}`);
  return response.data.data;
}

export async function deleteLibrary(libraryId) {
  const response = await api.delete(`/documents/libraries/${libraryId}`);
  return response.data;
}
