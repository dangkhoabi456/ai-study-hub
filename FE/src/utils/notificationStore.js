import { getUserStoredItem, setUserStoredItem } from "./userStorage.js";

const NOTIFICATION_SETTINGS_KEY = "aiStudyHubNotificationSettings";
const NOTIFICATIONS_KEY = "aiStudyHubNotifications";

export const defaultNotificationSettings = {
  enabled: true,
  showBadge: true,
  sound: false,

  discussion: {
    newTopic: true,
    solved: true,
  },

  task: {
    assigned: true,
    completed: false,
    deadlineReminder: true,
  },

  file: {
    uploaded: true,
    deleted: true,
  },

  member: {
    joined: true,
    roleChanged: true,
  },

  workspace: {
    renamed: true,
    deleted: true,
  },

  deadlineReminder: "1_day_before",

  doNotDisturb: {
    enabled: false,
    from: "22:00",
    to: "07:00",
  },
};

export function getNotificationSettings() {
  try {
    const savedSettings = JSON.parse(
      getUserStoredItem(NOTIFICATION_SETTINGS_KEY) || "{}",
    );

    return {
      ...defaultNotificationSettings,
      ...savedSettings,

      discussion: {
        ...defaultNotificationSettings.discussion,
        ...(savedSettings.discussion || {}),
      },

      task: {
        ...defaultNotificationSettings.task,
        ...(savedSettings.task || {}),
      },

      file: {
        ...defaultNotificationSettings.file,
        ...(savedSettings.file || {}),
      },

      member: {
        ...defaultNotificationSettings.member,
        ...(savedSettings.member || {}),
      },

      workspace: {
        ...defaultNotificationSettings.workspace,
        ...(savedSettings.workspace || {}),
      },

      doNotDisturb: {
        ...defaultNotificationSettings.doNotDisturb,
        ...(savedSettings.doNotDisturb || {}),
      },
    };
  } catch (error) {
    console.error("Cannot read notification settings:", error);
    return defaultNotificationSettings;
  }
}

export function saveNotificationSettings(settings) {
  setUserStoredItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("aiStudyHubNotificationSettingsChanged"));
}

export function getNotifications() {
  try {
    return JSON.parse(getUserStoredItem(NOTIFICATIONS_KEY) || "[]");
  } catch (error) {
    console.error("Cannot read notifications:", error);
    return [];
  }
}

export function saveNotifications(notifications) {
  setUserStoredItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  window.dispatchEvent(new Event("aiStudyHubNotificationsChanged"));
}

export function createAppNotification({
  category,
  action,
  title,
  message,
  icon = "ti-bell",
  link = "",
}) {
  const settings = getNotificationSettings();

  if (!settings.enabled) return;

  if (!settings[category]?.[action]) return;

  const newNotification = {
    id: `notification-${Date.now()}`,
    category,
    action,
    title,
    message,
    icon,
    link,
    isRead: false,
    createdAt: "Just now",
    createdAtMs: Date.now(),
  };

  const nextNotifications = [newNotification, ...getNotifications()];

  saveNotifications(nextNotifications);
}

export function markAllNotificationsAsRead() {
  const nextNotifications = getNotifications().map((notification) => ({
    ...notification,
    isRead: true,
  }));

  saveNotifications(nextNotifications);
}

export function mergeAppNotifications(incomingNotifications = []) {
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("aiStudyHubPendingInvitations")) {
        localStorage.removeItem(key);
      }
    });
  } catch (err) {
    console.error("Could not clean legacy localStorage keys:", err);
  }

  const settings = getNotificationSettings();
  if (!settings.enabled) return [];

  if (Array.isArray(incomingNotifications) && incomingNotifications.length > 0) {
    saveNotifications(incomingNotifications);
    return incomingNotifications;
  }

  return getNotifications();
}
