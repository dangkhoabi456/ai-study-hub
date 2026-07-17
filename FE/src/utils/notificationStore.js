const NOTIFICATION_SETTINGS_KEY = "aiStudyHubNotificationSettings";
const NOTIFICATIONS_KEY = "aiStudyHubNotifications";

export const defaultNotificationSettings = {
  enabled: true,
  showBadge: true,
  sound: false,
  browserNotification: false,

  discussion: {
    newTopic: true,
    topicDeleted: true,
    solved: true,
  },

  task: {
    assigned: true,
    completed: false,
    deadlineReminder: true,
  },

  file: {
    storageWarning: true,
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
      localStorage.getItem(NOTIFICATION_SETTINGS_KEY) || "{}",
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
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("aiStudyHubNotificationSettingsChanged"));
}

export function getNotifications() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) || "[]");
  } catch (error) {
    console.error("Cannot read notifications:", error);
    return [];
  }
}

export function saveNotifications(notifications) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
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

  const nextNotifications = [newNotification, ...getNotifications()].slice(
    0,
    30,
  );

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
  const settings = getNotificationSettings();
  if (!settings.enabled) return getNotifications();

  const currentNotifications = getNotifications();
  const existingById = new Map(
    currentNotifications.map((notification) => [notification.id, notification]),
  );

  incomingNotifications.forEach((notification) => {
    if (!notification?.id) return;
    if (!settings[notification.category]?.[notification.action]) return;

    const existing = existingById.get(notification.id);
    existingById.set(notification.id, {
      ...notification,
      isRead: existing?.isRead ?? false,
    });
  });

  const merged = [...existingById.values()]
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    .slice(0, 30);
  saveNotifications(merged);
  return merged;
}
