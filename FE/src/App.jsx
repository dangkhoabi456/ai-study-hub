import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SettingPage from "./components/pages/SettingPage/SettingPage.jsx";
// ================= AUTH IMPORTS =================
import LandingPage from "./components/pages/LandingPage/LandingPage.jsx";
import LoginPage from "./components/pages/LoginPage/LoginPage.jsx";
import ForgotPassword from "./components/pages/LoginPage/ForgotPassword.jsx";
import ResetPassword from "./components/pages/LoginPage/ResetPassword.jsx";

import RegisterGoogle from "./components/pages/RegisterPage/RegisterGoogle.jsx";
import CompleteProfile from "./components/pages/RegisterPage/CompleteProfile.jsx";
import EnterUserNamePass from "./components/pages/RegisterPage/EnterUserNamePass.jsx";
import OTPVerification from "./components/pages/RegisterPage/OTPVerification.jsx";

// ================= LAYOUT IMPORTS =================
import Dashboard from "./components/layout/Dashboard/Dashboard.jsx";

// ================= USER PAGE IMPORTS =================
import HomePage from "./components/pages/HomePage/HomePage.jsx";
import DiscoverPage from "./components/pages/DiscoverPage/DiscoverPage.jsx";
import MyLibraryPage from "./components/pages/MyLibraryPage/MyLibraryPage.jsx";
import CreateLibraryPage from "./components/pages/CreateLibraryPage/CreateLibraryPage.jsx";
import PersonalProfilePage from "./components/pages/PersonalProfilePage/PersonalProfilePage.jsx";
import SearchUserPage from "./components/pages/SearchUserPage/SearchUserPage";
import SearchResultPage from "./components/pages/SearchResultPage/SearchResultPage.jsx";
import NotificationsPage from "./components/pages/NotificationsPage/NotificationsPage.jsx";
// ================= PROTECTED ROUTE =================
import ProtectedRoute from "./components/common/ProtectedRoute/ProtectedRoute.jsx";

// ================= ADMIN IMPORTS =================
import AdminLayout from "./components/pages/Admin/AdminLayout/AdminLayout.jsx";

const ImportLibraryPage = lazy(() => import("./components/pages/ImportLibraryPage/ImportLibraryPage.jsx"));
const LibraryPage = lazy(() => import("./components/pages/LibraryPage/LibraryPage.jsx"));
const DocumentViewerPage = lazy(() => import("./components/pages/DocumentViewerPage/DocumentViewerPage.jsx"));
const Flashcards = lazy(() => import("./components/pages/Flashcards/Flashcards.jsx"));
const ChatBot = lazy(() => import("./components/pages/AIchatbot/ChatBot.jsx"));
const AdminDashboardPage = lazy(() => import("./components/pages/Admin/AdminDashboardPage/AdminDashboardPage.jsx"));
const AdminUsersPage = lazy(() => import("./components/pages/Admin/UserManagementPage/UserManagementPage.jsx"));
const AdminLogsPage = lazy(() => import("./components/pages/Admin/ActivityLogPage/ActivityLogPage.jsx"));
const AdminUsagePage = lazy(() => import("./components/pages/Admin/AdminUsagePage/AdminUsagePage.jsx"));
const AdminProfilePage = lazy(() => import("./components/pages/Admin/AdminProfilePage/AdminProfilePage.jsx"));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
      <Routes>
        {/* DEFAULT: vào web sẽ về login */}
        <Route path="/" element={<LandingPage />} />

        {/* AUTH ROUTES */}

        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/reset-password-otp" element={<ResetPassword />} />

        <Route path="/register" element={<RegisterGoogle />} />
        <Route path="/complete-profile" element={<CompleteProfile />} />

        <Route
          path="/enter-username-password"
          element={<EnterUserNamePass />}
        />

        <Route path="/verify-otp" element={<OTPVerification />} />
        <Route path="/otp-verification" element={<OTPVerification />} />

        {/* USER ROUTES - CẦN ĐĂNG NHẬP */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard/home" replace />} />

          <Route path="home" element={<HomePage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route
            path="ai-chat"
            element={<ChatBot defaultOpen={true} showBubble={false} />}
          />

          <Route path="libraries" element={<MyLibraryPage />} />
          <Route path="create-library" element={<CreateLibraryPage />} />
          <Route path="import-library" element={<ImportLibraryPage />} />
          <Route path="libraries/:libraryId" element={<LibraryPage />} />
          <Route path="documents/:documentId" element={<DocumentViewerPage />} />
          <Route path="settings" element={<SettingPage />} />

          <Route path="profile" element={<PersonalProfilePage />} />

          <Route path="profile/:id" element={<PersonalProfilePage />} />



          <Route path="flashcards" element={<Flashcards />} />
          <Route path="search-user" element={<SearchUserPage />} />
          <Route path="search" element={<SearchResultPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* ADMIN ROUTES - CHỈ SYSTEM_ADMIN TRUY CẬP ĐƯỢC */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["SYSTEM_ADMIN"]}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
          <Route path="usage" element={<AdminUsagePage />} />
          <Route path="settings" element={<SettingPage />} />
          <Route path="profile" element={<AdminProfilePage />} />
        </Route>

        {/* NOT FOUND */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
