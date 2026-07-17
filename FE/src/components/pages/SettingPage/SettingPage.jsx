import { useEffect, useState } from "react";
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
import "./SettingPage.css";

const SETTING_MENUS = [
  {
    title: "Personal",
    items: [
      { icon: "ti-user", label: "Profile & appearance" },
      { icon: "ti-id-badge", label: "Account" },
    ],
  },
  {
    title: "Notifications",
    items: [
      { icon: "ti-bell", label: "Notification settings" },
      { icon: "ti-email", label: "Email preferences" },
      { icon: "ti-time", label: "Do not disturb" },
    ],
  },
  {
    title: "Security",
    items: [
      { icon: "ti-key", label: "Password & authentication" },
      { icon: "ti-desktop", label: "Active sessions" },
      { icon: "ti-harddrives", label: "Data & account" },
    ],
  },
];

const PLANNED_SECTIONS = {
  Account: {
    icon: "ti-user",
    eyebrow: "Personal",
    title: "Account",
    description:
      "Manage the identity you use to sign in and where account messages are delivered.",
    note: "These controls need account APIs before they can safely save changes.",
    items: [
      {
        title: "Login email",
        description: "Change your email after verifying the new address.",
        impact: "Updates your sign-in identity and security email destination.",
      },
      {
        title: "Connected accounts",
        description: "Review Google and other sign-in methods linked to your account.",
        impact: "Provides another secure way to access your study space.",
      },
    ],
  },
  "Email preferences": {
    icon: "ti-email",
    eyebrow: "Notifications",
    title: "Email preferences",
    description:
      "Choose which collaboration and study updates should also reach your inbox.",
    note: "Security emails will remain enabled. Optional emails need a delivery service.",
    items: [
      {
        title: "Workspace invitations",
        description: "Receive an email when someone invites you to collaborate.",
        impact: "Helps you notice invitations when you are away from the app.",
      },
      {
        title: "Mentions and replies",
        description: "Receive email for direct mentions and discussion replies.",
        impact: "Keeps important conversations visible outside the app.",
      },
      {
        title: "Weekly study summary",
        description: "Get a short report of study time and completed reviews.",
        impact: "Provides a regular view of learning consistency.",
      },
    ],
  },
  "Active sessions": {
    icon: "ti-desktop",
    eyebrow: "Security",
    title: "Active sessions",
    description:
      "Review browsers and devices that currently have access to your account.",
    note: "Session management requires server-side token tracking before activation.",
    items: [
      {
        title: "Current device",
        description: "See the browser, location, and most recent activity.",
        impact: "Helps you recognize the session you are using now.",
      },
      {
        title: "Other devices",
        description: "Review every device that still has an active session.",
        impact: "Makes unfamiliar access easier to identify.",
      },
      {
        title: "Sign out everywhere",
        description: "Revoke all sessions except the one currently in use.",
        impact: "Forces other devices to authenticate again.",
      },
    ],
  },
};

const COLOR_OPTIONS = [
  "#4b5563",
  "#8b5cf6",
  "#0ea5e9",
  "#ec4899",
  "#a855f7",
  "#6366f1",
  "#b4531a",
  "#0f9f9a",
  "#a78b72",
  "#10b981",
];

const NOTIFICATION_CATEGORIES = [
  {
    key: "discussion",
    icon: "ti-comments",
    title: "Discussion",
    description: "New, resolved, and deleted discussion topics.",
    options: [
      ["newTopic", "New topic"],
      ["topicDeleted", "Topic deleted"],
      ["solved", "Topic solved"],
    ],
  },
  {
    key: "file",
    icon: "ti-folder",
    title: "File",
    description: "Storage capacity alerts for your libraries.",
    options: [
      ["storageWarning", "Storage warning"],
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
    key: "chat",
    icon: "ti-comment-alt",
    title: "Chat",
    description: "Choose when workspace conversations notify you.",
    selection: "single",
    options: [
      ["all", "All conversations"],
      ["mentions", "Only when mentioned"],
    ],
  },
  {
    key: "workspace",
    icon: "ti-layout-grid2",
    title: "Workspace",
    description: "Changes to workspace identity and availability.",
    options: [
      ["nameChanged", "Workspace name changed"],
      ["deleted", "Workspace deleted"],
    ],
  },
];

const LIBRARY_NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES.filter(
  (category) => category.key === "file",
);
const WORKSPACE_NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES.filter(
  (category) => category.key !== "file",
);

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
    getAuthStorage().getItem(PROFILE_NAME_KEY) ||
    "AI Student Hub"
  );
}

function getProfileNameChangedAt() {
  const timestamp = Number(
    getAuthStorage().getItem(PROFILE_NAME_CHANGED_AT_KEY),
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
  const { theme, setTheme, availableThemes } = useTheme();
  const [workspaceName, setWorkspaceName] = useState(getInitialProfileName);
  const [savedProfileName, setSavedProfileName] =
    useState(getInitialProfileName);
  const [profileNameChangedAt, setProfileNameChangedAt] = useState(
    getProfileNameChangedAt,
  );
  const [profileNameStatus, setProfileNameStatus] = useState("");
  const [selectedColor, setSelectedColor] = useState("#b4531a");
  const [activeSetting, setActiveSetting] = useState("Profile & appearance");
  const [notificationSettings, setNotificationSettings] = useState(() =>
    getNotificationSettings(),
  );

  useEffect(() => {
    saveNotificationSettings(notificationSettings);
  }, [notificationSettings]);

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

  function updateDoNotDisturb(key, value) {
    setNotificationSettings((previousSettings) => ({
      ...previousSettings,
      doNotDisturb: {
        ...previousSettings.doNotDisturb,
        [key]: value,
      },
    }));
  }

  function handleProfileNameChange(value) {
    setWorkspaceName(value.slice(0, PROFILE_NAME_MAX_LENGTH));
    setProfileNameStatus("");
  }

  function handleSaveProfileName() {
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

    const nextChangedAt = Date.now();
    const storedUser = getStoredUser();
    const nextUser = {
      ...storedUser,
      full_name: nextName,
      fullName: nextName,
      display_name: nextName,
      displayName: nextName,
      name: nextName,
    };

    const authStorage = getAuthStorage();
    authStorage.setItem(PROFILE_NAME_KEY, nextName);
    authStorage.setItem(PROFILE_NAME_CHANGED_AT_KEY, String(nextChangedAt));
    authStorage.setItem("user", JSON.stringify(nextUser));

    setWorkspaceName(nextName);
    setSavedProfileName(nextName);
    setProfileNameChangedAt(nextChangedAt);
    setProfileNameStatus("Display name saved. You can change it again after 7 days.");
    window.dispatchEvent(new Event("aiStudyHubProfileNameChanged"));
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
            <p>Shape how your study space works for you.</p>
          </div>
        </header>

        <nav className="settings_menu_groups" aria-label="Settings sections">
          {SETTING_MENUS.map((group) => (
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
              onWorkspaceNameChange={handleProfileNameChange}
              onSaveProfileName={handleSaveProfileName}
              selectedColor={selectedColor}
              setSelectedColor={setSelectedColor}
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

          {activeSetting === "Do not disturb" && (
            <DoNotDisturbSettings
              notificationSettings={notificationSettings}
              updateDoNotDisturb={updateDoNotDisturb}
            />
          )}

          {activeSetting === "Password & authentication" && (
            <PasswordSettings />
          )}

          {activeSetting === "Data & account" && <DataAccountSettings />}

          {PLANNED_SECTIONS[activeSetting] && (
            <PlannedSettingsSection config={PLANNED_SECTIONS[activeSetting]} />
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

function ProfileAppearanceSettings({
  workspaceName,
  savedProfileName,
  profileNameStatus,
  profileNameCooldownText,
  profileNameMaxLength,
  onWorkspaceNameChange,
  onSaveProfileName,
  selectedColor,
  setSelectedColor,
  selectedTheme,
  setSelectedTheme,
  availableThemes,
}) {
  const trimmedName = workspaceName.trim().replace(/\s+/g, " ");
  const isNameLocked = Boolean(profileNameCooldownText);
  const canSaveProfileName =
    !isNameLocked && trimmedName.length > 0 && trimmedName !== savedProfileName;

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
                  disabled={isNameLocked}
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
                Save
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

          <SettingRow
            title="Round logo"
            description="Recommended size: 72 x 72 px PNG for the workspace avatar."
          >
            <button type="button" className="settings_add_btn">
              Add image
            </button>
          </SettingRow>

          <SettingRow
            title="Rectangle logo"
            description="Recommended size: 232 x 48 px PNG for public links."
          >
            <button type="button" className="settings_add_btn">
              Add image
            </button>
          </SettingRow>

          <SettingRow
            title="Social preview"
            description="Used when a public workspace link is shared."
          >
            <button type="button" className="settings_add_btn">
              Add image
            </button>
          </SettingRow>

          <SettingRow
            title="Accent color"
            description="Choose the highlight color for this workspace."
          >
            <div className="settings_color_list">
              {COLOR_OPTIONS.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={selectedColor === color ? "active" : ""}
                  style={{ backgroundColor: color }}
                  onClick={() => setSelectedColor(color)}
                  aria-label={`Choose color ${color}`}
                  aria-pressed={selectedColor === color}
                ></button>
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
        title="Library notifications"
        description="Choose which library and document events are added to your notification feed."
      >
        <div className="notification_category_grid is_library">
          {LIBRARY_NOTIFICATION_CATEGORIES.map((category) => (
            <article className="notification_category_card" key={category.key}>
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
        title="Workspace notifications"
        description="Choose which workspace collaboration events are added to your notification feed."
      >
        <div className="notification_category_grid">
          {WORKSPACE_NOTIFICATION_CATEGORIES.map((category) => (
            <article className="notification_category_card" key={category.key}>
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
                      type={category.selection === "single" ? "radio" : "checkbox"}
                      name={
                        category.selection === "single"
                          ? `notification-${category.key}`
                          : undefined
                      }
                      checked={
                        category.selection === "single"
                          ? notificationSettings[category.key].mode === key
                          : notificationSettings[category.key][key]
                      }
                      onChange={() => {
                        if (category.selection === "single") {
                          setNotificationSettings((previousSettings) => ({
                            ...previousSettings,
                            [category.key]: {
                              ...previousSettings[category.key],
                              mode: key,
                            },
                          }));
                          return;
                        }

                        toggleNotificationCategory(category.key, key);
                      }}
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

function DoNotDisturbSettings({
  notificationSettings,
  updateDoNotDisturb,
}) {
  const doNotDisturb = notificationSettings.doNotDisturb;

  return (
    <>
      <SettingsHeader
        icon="ti-time"
        eyebrow="Notifications"
        title="Do not disturb"
        description="Keep notifications available without letting them interrupt focused study."
        badge={doNotDisturb.enabled ? "Quiet hours on" : "Quiet hours off"}
      />

      <div className="settings_quiet_summary">
        <div className="settings_quiet_clock">
          <i className="ti-time" aria-hidden="true"></i>
        </div>
        <div>
          <span>Current quiet window</span>
          <strong>
            {doNotDisturb.enabled
              ? `${doNotDisturb.from} to ${doNotDisturb.to}`
              : "No quiet hours scheduled"}
          </strong>
          <p>
            Notifications are still saved. Sounds and popups pause during this
            window.
          </p>
        </div>
      </div>

      <SettingsPanel
        title="Quiet hours"
        description="Choose when notification sound and browser popups should pause."
      >
        <div className="settings_table">
          <SettingRow
            title="Enable do not disturb"
            description="Continue collecting notifications without interrupting you."
          >
            <SettingsSwitch
              checked={doNotDisturb.enabled}
              onClick={() =>
                updateDoNotDisturb("enabled", !doNotDisturb.enabled)
              }
              label="Toggle do not disturb"
            />
          </SettingRow>

          {doNotDisturb.enabled && (
            <SettingRow
              title="Quiet window"
              description="Set the beginning and end of your uninterrupted study time."
            >
              <div className="settings_time_range">
                <label className="settings_field">
                  <span>From</span>
                  <input
                    type="time"
                    value={doNotDisturb.from}
                    onChange={(event) =>
                      updateDoNotDisturb("from", event.target.value)
                    }
                  />
                </label>

                <span className="settings_time_separator">to</span>

                <label className="settings_field">
                  <span>Until</span>
                  <input
                    type="time"
                    value={doNotDisturb.to}
                    onChange={(event) =>
                      updateDoNotDisturb("to", event.target.value)
                    }
                  />
                </label>
              </div>
            </SettingRow>
          )}
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
            <input
              type="password"
              name="currentPassword"
              value={form.currentPassword}
              onChange={updateField}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="settings_field">
            <span>New password</span>
            <input
              type="password"
              name="newPassword"
              value={form.newPassword}
              onChange={updateField}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="settings_field">
            <span>Confirm new password</span>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={updateField}
              autoComplete="new-password"
              minLength={8}
              required
            />
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

function PlannedSettingsSection({ config }) {
  return (
    <>
      <SettingsHeader
        icon={config.icon}
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        badge="Interface preview"
      />

      <div className="settings_preview_notice">
        <i className="ti-info-alt" aria-hidden="true"></i>
        <div>
          <strong>Preview only</strong>
          <p>{config.note}</p>
        </div>
      </div>

      <section className="settings_planned_list">
        {config.items.map((item, index) => (
          <article className="settings_planned_item" key={item.title}>
            <span className="settings_planned_number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <small>{item.impact}</small>
            </div>
            <span className="settings_planned_status">Not connected</span>
          </article>
        ))}
      </section>
    </>
  );
}

export default SettingPage;
