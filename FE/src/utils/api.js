import axios from "axios";
import {
  clearStoredSession,
  getAccessToken,
  getAuthStorage,
  getTokenExpiryMs,
} from "./authToken";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  withCredentials: true,
});

let refreshPromise = null;
let refreshTimer = null;
const REFRESH_EARLY_MS = 2 * 60 * 1000;

function scheduleAccessRefresh(accessToken) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const expiryMs = getTokenExpiryMs(accessToken);
  if (!expiryMs) return;

  const delay = expiryMs - Date.now() - REFRESH_EARLY_MS;
  if (delay <= 0) return;

  refreshTimer = setTimeout(() => {
    refreshAccessToken().catch(() => {
      // The response interceptor will handle user-facing logout on the next
      // authenticated request. A background refresh should not interrupt work.
    });
  }, delay);
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${api.defaults.baseURL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((response) => {
        const accessToken = response.data?.data?.accessToken;
        const user = response.data?.data?.user;

        if (!accessToken) {
          throw new Error("Refresh response did not include an access token.");
        }

        getAuthStorage().setItem("accessToken", accessToken);
        if (user) {
          getAuthStorage().setItem("user", JSON.stringify(user));
        }
        scheduleAccessRefresh(accessToken);

        return accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.request.use(
  async (config) => {
    let token = getAccessToken();

    config.headers = config.headers || {};

    const expiryMs = getTokenExpiryMs(token);
    const shouldRefreshBeforeRequest =
      expiryMs && expiryMs - Date.now() <= REFRESH_EARLY_MS;

    if (shouldRefreshBeforeRequest) {
      try {
        token = await refreshAccessToken();
      } catch {
        // Let the original request continue. If the session is actually gone,
        // the response interceptor will perform the normal cleanup flow.
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      scheduleAccessRefresh(token);
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor cho Response
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      const originalRequest = error.config || {};
      const url = originalRequest.url || "";
      const isAuthAttempt =
        url.includes("/auth/login") ||
        url.includes("/auth/refresh") ||
        url.includes("/auth/verify-otp") ||
        url.includes("/auth/verify-reset-otp") ||
        url.includes("/auth/complete-setup") ||
        url.includes("/auth/google");

      const isSessionInvalidated =
        error.response.data?.code === "SESSION_EXPIRED";

      if (!isAuthAttempt && !originalRequest._retry && !isSessionInvalidated) {
        originalRequest._retry = true;

        try {
          const accessToken = await refreshAccessToken();
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch {
          // Continue to the shared cleanup below.
        }
      }

      if (!isAuthAttempt) {
        if (error.response.data?.code === "SESSION_EXPIRED") {
          alert("Your session has expired because this account logged in from another device.");
        } else {
          alert("Your session has expired or is invalid. Please log in again.");
        }

        // Dọn dẹp vùng nhớ
        clearStoredSession();
        
        // Cưỡng chế điều hướng về trang đăng nhập
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
