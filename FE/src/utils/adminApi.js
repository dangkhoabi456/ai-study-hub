import api from "./api";

export async function getAdminDashboard() {
  const response = await api.get("/admin/dashboard");
  return response.data.data;
}

export async function getActivityLogs() {
  const response = await api.get("/admin/logs");
  return response.data.data;
}

export async function getAdminUsers(search = "") {
  const response = await api.get("/admin/users", {
    params: search ? { search } : {},
  });

  return response.data.data;
}

export async function updateUserStatus(userId, status, reason = "") {
  const response = await api.patch(`/admin/users/${userId}/status`, {
    status,
    reason,
  });

  return response.data.data;
}

export async function getUsageStats() {
  const response = await api.get("/admin/usage");
  return response.data.data;
}

export async function updateUserRole(userId, role, reason = "") {
  const response = await api.patch(`/admin/users/${userId}/role`, {
    role,
    reason,
  });

  return response.data.data;
}

export async function getDeletedWorkspaces() {
  const response = await api.get("/admin/workspaces/deleted");
  return response.data.data;
}

export async function getWorkspacePurgePreview(workspaceId) {
  const response = await api.get(`/admin/workspaces/${workspaceId}/purge-preview`);
  return response.data.data;
}

export async function permanentlyDeleteWorkspace(workspaceId, confirmation) {
  const response = await api.delete(`/admin/workspaces/${workspaceId}/permanent`, { data: { confirmation } });
  return response.data.data;
}

export async function restoreWorkspace(workspaceId) { const response = await api.patch(`/admin/workspaces/${workspaceId}/restore`); return response.data.data; }
