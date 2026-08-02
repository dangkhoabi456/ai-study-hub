import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  getNotificationSettings,
  saveNotificationSettings,
} from "../../../utils/notificationStore.js";
import { useTheme } from "../../../context/ThemeContext.jsx";
import api from "../../../utils/api.js";
import {
  clearStoredSession,
  getAuthStorage,
} from "../../../utils/authToken.js";
import {
  getUserStoredItem,
  removeUserStoredItem,
  setUserStoredItem,
} from "../../../utils/userStorage.js";
import {
  getMyProfile,
  updateMyProfile,
} from "../../../utils/profileApi.js";
import "./SettingPage.css";

const SETTING_MENUS = [
  {
    title: "Personal",
    items: [
      { icon: "ti-user", label: "Profile & appearance" },
    ],
  },
  {
    title: "Notifications",
    items: [
      { icon: "ti-bell", label: "Notification settings" },
    ],
  },
  {
    title: "Security",
    items: [
      { icon: "ti-key", label: "Password & authentication" },
      { icon: "ti-harddrives", label: "Data & account" },
    ],
  },
];

const ADMIN_SETTING_MENU = {
  title: "Administration",
  items: [{ icon: "ti-shield", label: "Admin controls" }],
};

const ADMIN_SETTINGS_KEY = "aiStudyHubAdminSettings";

function getInitialAdminSettings() {
  const defaults = {
    securityAlerts: true,
  };

  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(ADMIN_SETTINGS_KEY) || "{}"),
    };
  } catch {
    return defaults;
  }
}

const NOTIFICATION_CATEGORIES = [
  {
    key: "discussion",
    icon: "ti-comments",
    title: "Discussion",
    description: "New topics and solved discussions.",
    options: [
      ["newTopic", "New topic"],
      ["solved", "Topic solved"],
    ],
  },
  {
    key: "file",
    icon: "ti-folder",
    title: "File",
    description: "Document uploads and deletions.",
    options: [
      ["uploaded", "File uploaded"],
      ["deleted", "File deleted"],
    ],
  },
  {
    key: "member",
    icon: "ti-user",
    title: "Member",
    description: "New members and role changes.",
    options: [
      ["joined", "New member joined"],
      ["roleChanged", "Role changed"],
    ],
  },
  {
    key: "workspace",
    icon: "ti-layout-grid2",
    title: "Workspace",
    description: "Workspace name changes and deletions.",
    options: [
      ["renamed", "Workspace renamed"],
      ["deleted", "Workspace deleted"],
    ],
  },
];

const PROFILE_NAME_KEY = "aiStudyHubProfileName";
const PROFILE_NAME_CHANGED_AT_KEY = "aiStudyHubProfileNameChangedAt";
const PROFILE_NAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_NAME_MAX_LENGTH = 40;

function getStoredUser() {
  const storages = [getAuthStorage(), localStorage, sessionStorage];

  for (const storage of [...new Set(storages)]) {
    try {
      const user = JSON.parse(storage.getItem("user") || "null");
      if (
        user &&
        (user.full_name ||
          user.fullName ||
          user.display_name ||
          user.displayName ||
          user.name ||
          user.username)
      ) {
        return user;
      }
    } catch (error) {
      console.error("Cannot read the stored user profile:", error);
    }
  }

  return {};
}

function getInitialProfileName() {
  const storedUser = getStoredUser();

  return (
    storedUser.full_name ||
    storedUser.fullName ||
    storedUser.display_name ||
    storedUser.displayName ||
    storedUser.name ||
    storedUser.username ||
    getUserStoredItem(PROFILE_NAME_KEY) ||
    "AI Student Hub"
  );
}

function getProfileNameChangedAt() {
  const timestamp = Number(
    getUserStoredItem(PROFILE_NAME_CHANGED_AT_KEY),
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getProfileNameCooldownText(lastChangedAt) {
  if (!lastChangedAt) return "";

  const remainingMs =
    PROFILE_NAME_COOLDOWN_MS - (Date.now() - Number(lastChangedAt));

  if (remainingMs <= 0) return "";

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return `You can change your display name again in ${remainingDays} day${
    remainingDays === 1 ? "" : "s"
  }.`;
}

function SettingPage() {
  const location = useLocation();
  const isAdminSettings = location.pathname.startsWith("/admin/");
  const { theme, setTheme, availableThemes } = useTheme();
  const [workspaceName, setWorkspaceName] = useState(getInitialProfileName);
  const [savedProfileName, setSavedProfileName] =
    useState(getInitialProfileName);
  const [profileNameChangedAt, setProfileNameChangedAt] = useState(
    getProfileNameChangedAt,
  );
  const [profileNameStatus, setProfileNameStatus] = useState("");
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const [activeSetting, setActiveSetting] = useState("Profile & appearance");
  const [notificationSettings, setNotificationSettings] = useState(() =>
    getNotificationSettings(),
  );
  const [adminSettings, setAdminSettings] = useState(getInitialAdminSettings);

  const settingMenus = isAdminSettings
    ? [
        ...SETTING_MENUS.filter((group) => group.title !== "Notifications"),
        ADMIN_SETTING_MENU,
      ]
    : SETTING_MENUS;

  useEffect(() => {
    saveNotificationSettings(notificationSettings);
  }, [notificationSettings]);

  useEffect(() => {
    let isMounted = true;

    async function loadProfileName() {
      try {
        const profile = await getMyProfile();
        if (!isMounted) return;

        const profileName =
          profile?.full_name || profile?.username || profile?.email || "";
        const changedAt = profile?.last_name_change
          ? new Date(profile.last_name_change).getTime()
          : 0;

        if (profileName) {
          setWorkspaceName(profileName);
          setSavedProfileName(profileName);
        }
        setProfileNameChangedAt(Number.isFinite(changedAt) ? changedAt : 0);

        if (changedAt) {
          setUserStoredItem(
            PROFILE_NAME_CHANGED_AT_KEY,
            String(changedAt),
          );
        } else {
          removeUserStoredItem(PROFILE_NAME_CHANGED_AT_KEY);
        }
      } catch (error) {
        console.error("Cannot load the current profile name:", error);
      }
    }

    loadProfileName();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdminSettings) return;
    localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(adminSettings));
  }, [adminSettings, isAdminSettings]);

  function toggleNotificationSetting(key) {
    setNotificationSettings((previousSettings) => ({
      ...previousSettings,
      [key]: !previousSettings[key],
    }));
  }

  function toggleNotificationCategory(category, key) {
    setNotificationSettings((previousSettings) => ({
      ...previousSettings,
      [category]: {
        ...previousSettings[category],
        [key]: !previousSettings[category][key],
      },
    }));
  }

  function handleProfileNameChange(value) {
    setWorkspaceName(value.slice(0, PROFILE_NAME_MAX_LENGTH));
    setProfileNameStatus("");
  }

  async function handleSaveProfileName() {
    const nextName = workspaceName.trim().replace(/\s+/g, " ");
    const cooldownText = getProfileNameCooldownText(profileNameChangedAt);

    if (!nextName) {
      setProfileNameStatus("Display name cannot be empty.");
      return;
    }

    if (nextName === savedProfileName) {
      setWorkspaceName(nextName);
      setProfileNameStatus("This display name is already saved.");
      return;
    }

    if (cooldownText) {
      setProfileNameStatus(cooldownText);
      return;
    }

    try {
      setIsSavingProfileName(true);
      setProfileNameStatus("");

      const profile = await updateMyProfile({ full_name: nextName });
      const savedName = profile?.full_name || nextName;
      const changedAt = profile?.last_name_change
        ? new Date(profile.last_name_change).getTime()
        : Date.now();
      const storedUser = getStoredUser();
      const nextUser = {
        ...storedUser,
        full_name: savedName,
        fullName: savedName,
        display_name: savedName,
        displayName: savedName,
        name: savedName,
      };

      setUserStoredItem(PROFILE_NAME_KEY, savedName);
      setUserStoredItem(PROFILE_NAME_CHANGED_AT_KEY, String(changedAt));
      getAuthStorage().setItem("user", JSON.stringify(nextUser));

      setWorkspaceName(savedName);
      setSavedProfileName(savedName);
      setProfileNameChangedAt(changedAt);
      setProfileNameStatus(
        "Display name saved. You can change it again after 7 days.",
      );
      window.dispatchEvent(new Event("aiStudyHubProfileNameChanged"));
    } catch (error) {
      console.error("Cannot update the profile name:", error);
      setProfileNameStatus(
        error.response?.data?.message || "Could not update display name.",
      );
    } finally {
      setIsSavingProfileName(false);
    }
  }

  return (
    <main className="settings_page">
      <aside className="settings_sidebar">
        <header className="settings_sidebar_header">
          <div className="settings_sidebar_mark">
            <i className="ti-settings" aria-hidden="true"></i>
          </div>
          <div>
            <h1>Settings</h1>
            <p>
              {isAdminSettings
                ? "Manage your account and administration preferences."
                : "Shape how your study space works for you."}
            </p>
          </div>
        </header>

        <nav className="settings_menu_groups" aria-label="Settings sections">
          {settingMenus.map((group) => (
            <section className="settings_menu_group" key={group.title}>
              <h2>{group.title}</h2>

              <div className="settings_menu_items">
                {group.items.map((item) => {
                  const isActive = activeSetting === item.label;

                  return (
                    <button
                      type="button"
                      key={item.label}
                      className={isActive ? "active" : ""}
                      onClick={() => setActiveSetting(item.label)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <i className={item.icon} aria-hidden="true"></i>
                      <span>{item.label}</span>
                      <i
                        className="ti-angle-right settings_menu_arrow"
                        aria-hidden="true"
                      ></i>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

      </aside>

      <section className="settings_content">
        <div className="settings_content_inner" key={activeSetting}>
          {activeSetting === "Profile & appearance" && (
            <ProfileAppearanceSettings
              workspaceName={workspaceName}
              savedProfileName={savedProfileName}
              profileNameStatus={profileNameStatus}
              profileNameCooldownText={getProfileNameCooldownText(
                profileNameChangedAt,
              )}
              profileNameMaxLength={PROFILE_NAME_MAX_LENGTH}
              isSavingProfileName={isSavingProfileName}
              onWorkspaceNameChange={handleProfileNameChange}
              onSaveProfileName={handleSaveProfileName}
              selectedTheme={theme}
              setSelectedTheme={setTheme}
              availableThemes={availableThemes}
            />
          )}

          {activeSetting === "Notification settings" && (
            <NotificationSettings
              notificationSettings={notificationSettings}
              setNotificationSettings={setNotificationSettings}
              toggleNotificationSetting={toggleNotificationSetting}
              toggleNotificationCategory={toggleNotificationCategory}
            />
          )}

          {activeSetting === "Password & authentication" && (
            <PasswordSettings />
          )}

          {activeSetting === "Data & account" && <DataAccountSettings />}

          {isAdminSettings && activeSetting === "Admin controls" && (
            <AdminControlSettings
              settings={adminSettings}
              setSettings={setAdminSettings}
            />
          )}

        </div>
      </section>
    </main>
  );
}

function SettingsHeader({ icon, eyebrow, title, description, badge }) {
  return (
    <header className="settings_page_header">
      <div className="settings_header_icon">
        <i className={icon} aria-hidden="true"></i>
      </div>
      <div className="settings_header_copy">
        <div className="settings_header_meta">
          <span>{eyebrow}</span>
          {badge && <strong>{badge}</strong>}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

function SettingsPanel({ title, description, children }) {
  return (
    <section className="settings_panel">
      <header className="settings_panel_title">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function SettingRow({ title, description, children }) {
  return (
    <div className="settings_table_row">
      <div className="settings_row_copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="settings_row_control">{children}</div>
    </div>
  );
}

function SettingsSwitch({ checked, onClick, label }) {
  return (
    <button
      type="button"
      className={`settings_switch ${checked ? "on" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={checked}
    >
      <span></span>
    </button>
  );
}

function AdminControlSettings({ settings, setSettings }) {
  function toggle(key) {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="settings_section_stack">
      <SettingsHeader
        icon="ti-shield"
        eyebrow="Administration"
        title="Admin controls"
        description="Configure security alerts and operational controls for your administrator account."
        badge="Admin only"
      />

      <SettingsPanel
        title="Security & audit"
        description="Control important administrative security notifications."
      >
        <div className="settings_table">
          <SettingRow
            title="Critical security alerts"
            description="Receive alerts for account status, role and suspicious access changes."
          >
            <SettingsSwitch
              checked={settings.securityAlerts}
              onClick={() => toggle("securityAlerts")}
              label="Toggle critical security alerts"
            />
          </SettingRow>
          <SettingRow
            title="Audit logging"
            description="Administrative actions are recorded to protect accountability and system integrity."
          >
            <span className="admin_settings_locked"><i className="ti-lock" /> Always enabled</span>
          </SettingRow>
        </div>
      </SettingsPanel>
    </div>
  );
}

function ProfileAppearanceSettings({
  workspaceName,
  savedProfileName,
  profileNameStatus,
  profileNameCooldownText,
  profileNameMaxLength,
  isSavingProfileName,
  onWorkspaceNameChange,
  onSaveProfileName,
  selectedTheme,
  setSelectedTheme,
  availableThemes,
}) {
  const trimmedName = workspaceName.trim().replace(/\s+/g, " ");
  const isNameLocked = Boolean(profileNameCooldownText);
  const canSaveProfileName =
    !isNameLocked &&
    !isSavingProfileName &&
    trimmedName.length > 0 &&
    trimmedName !== savedProfileName;

  return (
    <>
      <SettingsHeader
        icon="ti-palette"
        eyebrow="Personal"
        title="Profile & appearance"
        description="Manage the name and visual identity used across your StudyHub account."
        badge="Local preferences"
      />

      <SettingsPanel
        title="User profile"
        description="Basic information displayed around your libraries and shared spaces."
      >
        <div className="settings_table">
          <SettingRow
            title="User avatar"
            description="Generated from the first letter of your display name."
          >
            <div className="settings_avatar">
              {workspaceName.slice(0, 1).toUpperCase() || "A"}
            </div>
          </SettingRow>

          <SettingRow
            title="User name"
            description="The display name shown on your profile and study spaces."
          >
            <div className="settings_name_editor">
              <label className="settings_field">
                <span>Display name</span>
                <input
                  value={workspaceName}
                  maxLength={profileNameMaxLength}
                disabled={isNameLocked || isSavingProfileName}
                  onChange={(event) =>
                    onWorkspaceNameChange(event.target.value)
                  }
                />
              </label>
              <button
                type="button"
                className="settings_save_name_btn"
                disabled={!canSaveProfileName}
                onClick={onSaveProfileName}
              >
                {isSavingProfileName ? "Saving..." : "Save"}
              </button>
              <p
                className={`settings_name_hint ${
                  profileNameStatus ? "has_status" : ""
                }`}
              >
                {profileNameStatus ||
                  profileNameCooldownText ||
                  `You can change this name once every 7 days. ${workspaceName.length}/${profileNameMaxLength}`}
              </p>
            </div>
          </SettingRow>
        </div>
      </SettingsPanel>

      <SettingsPanel
        title="Workspace appearance"
        description="Keep shared pages visually consistent with your study space."
      >
        <div className="settings_table">
          <SettingRow
            title="Theme"
            description="Choose the visual style used across your StudyHub workspace."
          >
            <div
              className="settings_theme_list"
              role="radiogroup"
              aria-label="Choose StudyHub theme"
            >
              {availableThemes.map((theme) => (
                <button
                  type="button"
                  key={theme.value}
                  className={`settings_theme_option theme_${theme.value} ${
                    selectedTheme === theme.value ? "active" : ""
                  }`}
                  onClick={() => setSelectedTheme(theme.value)}
                  role="radio"
                  aria-checked={selectedTheme === theme.value}
                >
                  {selectedTheme === theme.value && (
                    <span className="settings_theme_check" aria-hidden="true">
                      <i className="ti-check"></i>
                    </span>
                  )}
                  <span className="settings_theme_preview" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                  <span className="settings_theme_text">
                    <strong>{theme.label}</strong>
                    <small>{theme.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </SettingRow>

        </div>
      </SettingsPanel>
    </>
  );
}

function NotificationSettings({
  notificationSettings,
  setNotificationSettings,
  toggleNotificationSetting,
  toggleNotificationCategory,
}) {
  return (
    <>
      <SettingsHeader
        icon="ti-bell"
        eyebrow="Notifications"
        title="Notification settings"
        description="Choose which activity deserves your attention inside AI Study Hub."
        badge="Saved automatically"
      />

      <SettingsPanel
        title="Notification behavior"
        description="Control how new activity appears while you use the app."
      >
        <div className="settings_table">
          <SettingRow
            title="Enable notifications"
            description="Allow the app to create notifications for important activity."
          >
            <SettingsSwitch
              checked={notificationSettings.enabled}
              onClick={() => toggleNotificationSetting("enabled")}
              label="Toggle notifications"
            />
          </SettingRow>

          <SettingRow
            title="Show unread badge"
            description="Display the unread count on the notification bell."
          >
            <SettingsSwitch
              checked={notificationSettings.showBadge}
              onClick={() => toggleNotificationSetting("showBadge")}
              label="Toggle unread badge"
            />
          </SettingRow>

        </div>
      </SettingsPanel>

      <SettingsPanel
        title="Activity categories"
        description="Fine-tune which events are added to your notification feed."
      >
        <div className="notification_category_grid">
          {NOTIFICATION_CATEGORIES.map((category) => (
            <article
              className={`notification_category_card ${
                ["discussion", "file"].includes(category.key)
                  ? "is_compact"
                  : ""
              }`}
              key={category.key}
            >
              <header className="notification_category_header">
                <i className={category.icon} aria-hidden="true"></i>
                <div>
                  <h3>{category.title}</h3>
                  <p>{category.description}</p>
                </div>
              </header>

              <div className="notification_category_options">
                {category.options.map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={notificationSettings[category.key][key]}
                      onChange={() =>
                        toggleNotificationCategory(category.key, key)
                      }
                    />
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </SettingsPanel>

      <SettingsPanel
        title="Reminder schedule"
        description="Set the default time for task and subtask deadline reminders."
      >
        <div className="settings_table">
          <SettingRow
            title="Deadline reminder"
            description="Applied when a task does not define its own reminder."
          >
            <label className="settings_field">
              <span>Reminder time</span>
              <select
                className="settings_select"
                value={notificationSettings.deadlineReminder}
                onChange={(event) =>
                  setNotificationSettings((previousSettings) => ({
                    ...previousSettings,
                    deadlineReminder: event.target.value,
                  }))
                }
              >
                <option value="none">No reminder</option>
                <option value="at_due_time">At due time</option>
                <option value="10_minutes_before">10 minutes before</option>
                <option value="1_hour_before">1 hour before</option>
                <option value="1_day_before">1 day before</option>
              </select>
            </label>
          </SettingRow>
        </div>
      </SettingsPanel>
    </>
  );
}

function PasswordSettings() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });

  function togglePasswordVisibility(fieldName) {
    setVisiblePasswords((previous) => ({
      ...previous,
      [fieldName]: !previous[fieldName],
    }));
  }

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setStatus({ type: "", message: "" });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (form.newPassword !== form.confirmPassword) {
      setStatus({ type: "error", message: "New passwords do not match." });
      return;
    }

    setIsSaving(true);
    setStatus({ type: "", message: "" });

    try {
      const response = await api.post("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setStatus({
        type: "success",
        message: response.data?.message || "Password changed successfully.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error.response?.data?.message ||
          "Unable to change password. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <SettingsHeader
        icon="ti-key"
        eyebrow="Security"
        title="Password & authentication"
        description="Change your password after confirming your current password."
      />

      <SettingsPanel
        title="Change password"
        description="Use at least 8 characters, including a lowercase letter, a number, and a special character."
      >
        <form className="settings_password_form" onSubmit={handleSubmit}>
          <label className="settings_field">
            <span>Current password</span>
            <div className="settings_password_input_wrap">
              <input
                type={visiblePasswords.currentPassword ? "text" : "password"}
                name="currentPassword"
                value={form.currentPassword}
                onChange={updateField}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className={`settings_password_visibility ${
                  visiblePasswords.currentPassword ? "is_visible" : "is_hidden"
                }`}
                onClick={() => togglePasswordVisibility("currentPassword")}
                aria-label={
                  visiblePasswords.currentPassword
                    ? "Hide current password"
                    : "Show current password"
                }
                aria-pressed={visiblePasswords.currentPassword}
                title={
                  visiblePasswords.currentPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                <i className="ti-eye" aria-hidden="true"></i>
              </button>
            </div>
          </label>
          <label className="settings_field">
            <span>New password</span>
            <div className="settings_password_input_wrap">
              <input
                type={visiblePasswords.newPassword ? "text" : "password"}
                name="newPassword"
                value={form.newPassword}
                onChange={updateField}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                className={`settings_password_visibility ${
                  visiblePasswords.newPassword ? "is_visible" : "is_hidden"
                }`}
                onClick={() => togglePasswordVisibility("newPassword")}
                aria-label={
                  visiblePasswords.newPassword
                    ? "Hide new password"
                    : "Show new password"
                }
                aria-pressed={visiblePasswords.newPassword}
                title={
                  visiblePasswords.newPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                <i className="ti-eye" aria-hidden="true"></i>
              </button>
            </div>
          </label>
          <label className="settings_field">
            <span>Confirm new password</span>
            <div className="settings_password_input_wrap">
              <input
                type={visiblePasswords.confirmPassword ? "text" : "password"}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={updateField}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                className={`settings_password_visibility ${
                  visiblePasswords.confirmPassword ? "is_visible" : "is_hidden"
                }`}
                onClick={() => togglePasswordVisibility("confirmPassword")}
                aria-label={
                  visiblePasswords.confirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
                }
                aria-pressed={visiblePasswords.confirmPassword}
                title={
                  visiblePasswords.confirmPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                <i className="ti-eye" aria-hidden="true"></i>
              </button>
            </div>
          </label>

          {status.message && (
            <p className={`settings_password_status ${status.type}`} role="status">
              {status.message}
            </p>
          )}

          <button
            className="settings_save_name_btn settings_password_submit"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? "Changing..." : "Change password"}
          </button>
        </form>
      </SettingsPanel>
    </>
  );
}

function DataAccountSettings() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteAccount(event) {
    event.preventDefault();
    setStatus("");

    if (confirmation !== "DELETE") {
      setStatus('Type "DELETE" exactly to confirm.');
      return;
    }

    setIsDeleting(true);
    try {
      await api.delete("/auth/account", {
        data: { password, confirmation },
      });
      clearStoredSession();
      window.location.href = "/";
    } catch (error) {
      setStatus(
        error.response?.data?.message ||
          "Unable to delete your account. Please try again.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <>
      <SettingsHeader
        icon="ti-harddrives"
        eyebrow="Security"
        title="Data & account"
        description="Permanently delete your AI Study Hub account."
      />

      <SettingsPanel
        title="Delete account"
        description="This action is permanent and cannot be undone."
      >
        <form className="settings_delete_account" onSubmit={handleDeleteAccount}>
          <div className="settings_delete_warning">
            <i className="ti-alert" aria-hidden="true"></i>
            <div>
              <strong>Your account will be permanently deleted</strong>
              <p>You will lose access to your profile and associated study data.</p>
            </div>
          </div>

          <label className="settings_field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setStatus("");
              }}
              autoComplete="current-password"
              placeholder="Enter your current password"
            />
          </label>

          <label className="settings_field">
            <span>Type DELETE to confirm</span>
            <input
              type="text"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setStatus("");
              }}
              autoComplete="off"
              placeholder="DELETE"
              required
            />
          </label>

          {status && (
            <p className="settings_password_status error" role="alert">
              {status}
            </p>
          )}

          <button
            type="submit"
            className="settings_delete_account_btn"
            disabled={isDeleting || confirmation !== "DELETE"}
          >
            {isDeleting ? "Deleting account..." : "Delete my account"}
          </button>
        </form>
      </SettingsPanel>
    </>
  );
}

export default SettingPage;
