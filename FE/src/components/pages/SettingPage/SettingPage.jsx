import { useEffect, useState } from "react";
import {
  getNotificationSettings,
  saveNotificationSettings,
} from "../../../utils/notificationStore.js";
import { useTheme } from "../../../context/themeContextValue.js";
import "./SettingPage.css";

const SETTING_MENUS = [
  {
    title: "Personal",
    items: [
      { icon: "ti-user", label: "Profile & appearance" },
      { icon: "ti-id-badge", label: "Account" },
      { icon: "ti-eye", label: "Accessibility" },
    ],
  },
  {
    title: "Study",
    items: [
      { icon: "ti-target", label: "Study preferences" },
      { icon: "ti-wand", label: "AI preferences" },
      { icon: "ti-folder", label: "Documents & storage" },
    ],
  },
  {
    title: "Collaboration",
    items: [
      { icon: "ti-lock", label: "Privacy & discoverability" },
      { icon: "ti-comments", label: "Collaboration" },
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
    icon: "ti-id-badge",
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
      {
        title: "Account status",
        description: "Temporarily deactivate your profile without deleting study data.",
        impact: "Hides your account and pauses access until you return.",
      },
    ],
  },
  Accessibility: {
    icon: "ti-eye",
    eyebrow: "Personal",
    title: "Accessibility",
    description:
      "Adjust reading comfort, motion, contrast, and keyboard visibility across the app.",
    note: "These preferences will apply to the current device when implemented.",
    items: [
      {
        title: "Text size",
        description: "Choose a comfortable interface and reading scale.",
        impact: "Makes long documents and study controls easier to read.",
      },
      {
        title: "Reduced motion",
        description: "Limit decorative movement and animated transitions.",
        impact: "Creates a calmer experience and reduces motion discomfort.",
      },
      {
        title: "High contrast focus",
        description: "Use stronger outlines while navigating with a keyboard.",
        impact: "Makes the currently focused control easier to identify.",
      },
    ],
  },
  "Study preferences": {
    icon: "ti-target",
    eyebrow: "Study",
    title: "Study preferences",
    description:
      "Shape your daily study rhythm, reminders, and flashcard review sessions.",
    note: "These controls need a saved user-preferences profile before activation.",
    items: [
      {
        title: "Daily study goal",
        description: "Set the number of focused minutes you want to complete each day.",
        impact: "Changes progress targets and home-page study summaries.",
      },
      {
        title: "Review schedule",
        description: "Choose when flashcards and saved material should return for review.",
        impact: "Controls spaced repetition reminders and study queues.",
      },
      {
        title: "Time zone and week start",
        description: "Align schedules with your local calendar.",
        impact: "Keeps reminders and daily statistics on the correct date.",
      },
    ],
  },
  "AI preferences": {
    icon: "ti-wand",
    eyebrow: "Study",
    title: "AI preferences",
    description:
      "Choose how the assistant explains material and which study resources it may use.",
    note: "AI access rules must also be enforced by the backend before activation.",
    items: [
      {
        title: "Explanation style",
        description: "Choose concise, step-by-step, or academic explanations.",
        impact: "Changes the structure and depth of AI responses.",
      },
      {
        title: "Default response language",
        description: "Set the language the assistant should use first.",
        impact: "Keeps summaries, questions, and explanations consistent.",
      },
      {
        title: "Library access",
        description: "Select which libraries the assistant may reference.",
        impact: "Limits the study material included in AI answers.",
      },
    ],
  },
  "Documents & storage": {
    icon: "ti-folder",
    eyebrow: "Study",
    title: "Documents & storage",
    description:
      "Control upload processing, document defaults, and how storage is cleaned up.",
    note: "Storage actions need backend quota and file-management APIs.",
    items: [
      {
        title: "Default upload library",
        description: "Choose where new documents are placed when no location is selected.",
        impact: "Reduces repetitive sorting after every upload.",
      },
      {
        title: "Automatic text extraction",
        description: "Prepare uploaded PDFs and scans for search and AI use.",
        impact: "Improves search results but can increase processing time.",
      },
      {
        title: "Trash retention",
        description: "Choose how long deleted files remain recoverable.",
        impact: "Balances recovery time against available storage.",
      },
    ],
  },
  "Privacy & discoverability": {
    icon: "ti-lock",
    eyebrow: "Collaboration",
    title: "Privacy & discoverability",
    description:
      "Decide how other students can find you and which profile details they may see.",
    note: "Search and profile APIs must enforce these rules before activation.",
    items: [
      {
        title: "Search visibility",
        description: "Allow people to find your profile by name or username.",
        impact: "Controls whether you appear in global user search results.",
      },
      {
        title: "Email visibility",
        description: "Keep your login email private outside your own account page.",
        impact: "Prevents personal contact information from appearing in search.",
      },
      {
        title: "Activity status",
        description: "Choose whether collaborators can see when you were last active.",
        impact: "Changes the presence information shown in shared workspaces.",
      },
    ],
  },
  Collaboration: {
    icon: "ti-comments",
    eyebrow: "Collaboration",
    title: "Collaboration",
    description:
      "Set sensible defaults for invitations, shared libraries, comments, and downloads.",
    note: "These controls need workspace permission APIs before activation.",
    items: [
      {
        title: "Invitation permissions",
        description: "Choose who may invite you to a workspace.",
        impact: "Reduces unwanted invitations while keeping collaboration open.",
      },
      {
        title: "Default sharing role",
        description: "Start new collaborators as viewers or editors.",
        impact: "Sets the initial access level when you share study material.",
      },
      {
        title: "Comments and mentions",
        description: "Control whether collaborators may comment or mention you.",
        impact: "Changes how people can request your attention in shared work.",
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
  "Password & authentication": {
    icon: "ti-key",
    eyebrow: "Security",
    title: "Password & authentication",
    description:
      "Protect your account with a strong password and additional verification.",
    note: "Authentication changes need secure backend endpoints and re-verification.",
    items: [
      {
        title: "Change password",
        description: "Replace your current password after confirming your identity.",
        impact: "Invalidates an exposed password and protects future sign-ins.",
      },
      {
        title: "Two-step verification",
        description: "Require a second verification step for new sign-ins.",
        impact: "Protects your account even if someone learns your password.",
      },
      {
        title: "Login alerts",
        description: "Receive a warning when a new device signs in.",
        impact: "Helps you respond quickly to unfamiliar account access.",
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
  "Data & account": {
    icon: "ti-harddrives",
    eyebrow: "Security",
    title: "Data & account",
    description:
      "Export your information or permanently close your AI Study Hub account.",
    note: "Destructive actions need confirmation, re-authentication, and backend jobs.",
    items: [
      {
        title: "Export my data",
        description: "Request a copy of your profile, libraries, and account activity.",
        impact: "Creates a portable archive of information linked to your account.",
      },
      {
        title: "Deactivate account",
        description: "Temporarily stop access while keeping your data recoverable.",
        impact: "Hides your account until you choose to return.",
      },
      {
        title: "Delete account",
        description: "Permanently remove your profile and eligible personal data.",
        impact: "Cannot be reversed after the retention period ends.",
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
    description: "Topics, replies, and solved discussions.",
    options: [
      ["newTopic", "New topic"],
      ["newReply", "New reply"],
      ["solved", "Topic solved"],
    ],
  },
  {
    key: "task",
    icon: "ti-check-box",
    title: "Task",
    description: "Assignments, completions, and deadlines.",
    options: [
      ["assigned", "Assigned to me"],
      ["completed", "Task completed"],
      ["deadlineReminder", "Deadline reminder"],
    ],
  },
  {
    key: "file",
    icon: "ti-folder",
    title: "File",
    description: "Uploads, deletions, and storage alerts.",
    options: [
      ["uploaded", "File uploaded"],
      ["deleted", "File deleted"],
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
];

function SettingPage() {
  const { theme, setTheme, availableThemes } = useTheme();
  const [workspaceName, setWorkspaceName] = useState("AI Student Hub");
  const [customBranding, setCustomBranding] = useState(false);
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
              setWorkspaceName={setWorkspaceName}
              customBranding={customBranding}
              setCustomBranding={setCustomBranding}
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
  setWorkspaceName,
  customBranding,
  setCustomBranding,
  selectedColor,
  setSelectedColor,
  selectedTheme,
  setSelectedTheme,
  availableThemes,
}) {
  return (
    <>
      <SettingsHeader
        icon="ti-palette"
        eyebrow="Personal"
        title="Profile & appearance"
        description="Manage the name and visual identity used across your current study workspace."
        badge="Local preferences"
      />

      <SettingsPanel
        title="Workspace profile"
        description="Basic information displayed around your libraries and shared spaces."
      >
        <div className="settings_table">
          <SettingRow
            title="Workspace avatar"
            description="Generated from the first letter of your workspace name."
          >
            <div className="settings_avatar">
              {workspaceName.slice(0, 1).toUpperCase() || "A"}
            </div>
          </SettingRow>

          <SettingRow
            title="Workspace name"
            description="The display name shown in your current study space."
          >
            <label className="settings_field">
              <span>Display name</span>
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
          </SettingRow>
        </div>
      </SettingsPanel>

      <SettingsPanel
        title="Workspace appearance"
        description="Keep shared pages visually consistent with your study space."
      >
        <div className="settings_table">
          <SettingRow
            title="Enable custom branding"
            description="Turn on custom logos, color schemes, and public branding."
          >
            <SettingsSwitch
              checked={customBranding}
              onClick={() => setCustomBranding(!customBranding)}
              label="Toggle custom branding"
            />
          </SettingRow>

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

          <SettingRow
            title="Play notification sound"
            description="Play a short sound when new activity arrives."
          >
            <SettingsSwitch
              checked={notificationSettings.sound}
              onClick={() => toggleNotificationSetting("sound")}
              label="Toggle notification sound"
            />
          </SettingRow>

          <SettingRow
            title="Browser notifications"
            description="Allow desktop notifications when the browser supports them."
          >
            <SettingsSwitch
              checked={notificationSettings.browserNotification}
              onClick={() => toggleNotificationSetting("browserNotification")}
              label="Toggle browser notifications"
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
