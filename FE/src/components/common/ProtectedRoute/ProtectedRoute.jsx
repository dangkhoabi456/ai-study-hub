import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  clearStoredSession,
  getAccessToken,
  getStoredUser,
  isTokenValid,
} from "../../../utils/authToken";
import { refreshAccessToken } from "../../../utils/api";

const GUEST_ALLOWED_PATHS = [
  "/dashboard",
  "/dashboard/home",
  "/dashboard/discover",
  "/dashboard/libraries",
  "/dashboard/search",
  "/dashboard/settings",
];

function isGuestAllowedPath(pathname) {
  // Cho phép Guest xem catalog public và chi tiết thư viện công khai.
  if (pathname === "/dashboard") {
    return true;
  }

  if (pathname === "/dashboard/libraries" || pathname.startsWith("/dashboard/libraries/")) {
    return true;
  }

  if (pathname.startsWith("/dashboard/profile/")) {
    return true;
  }

  if (pathname.startsWith("/dashboard/documents/")) {
    return true;
  }

  return GUEST_ALLOWED_PATHS.some(
    (allowedPath) => pathname === allowedPath,
  );
}

function ProtectedRoute({ children, allowedRoles }) {
  const location = useLocation();
  const [authState, setAuthState] = useState(() =>
    isTokenValid(getAccessToken())
      ? "authenticated"
      : "checking",
  );
  const token = getAccessToken();
  const user = getStoredUser();
  const role = String(user?.role || "").toUpperCase();

  useEffect(() => {
    if (isTokenValid(getAccessToken())) {
      return;
    }

    let isMounted = true;
    refreshAccessToken()
      .then(() => {
        if (isMounted) setAuthState("authenticated");
      })
      .catch(() => {
        if (isMounted) setAuthState("unauthenticated");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (authState === "checking") {
    return null;
  }

  // Not logged in or token is expired/invalid
  if (authState === "unauthenticated" || !token || !isTokenValid(token)) {
    if (token) {
      clearStoredSession();
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // Logged in, but does not have required role
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/dashboard/home" replace />;
  }

  if (role === "GUEST" && !isGuestAllowedPath(location.pathname)) {
    return <Navigate to="/dashboard/home" replace />;
  }

  return children;
}

export default ProtectedRoute;
