const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

const NOTIFICATIONS_KEY = "twitchAntibanNotifications";
const SETTINGS_KEY = "twitchAntibanSettings";
const UNREAD_COUNT_KEY = "twitchAntibanUnreadCount";
const MAX_NOTIFICATIONS = 50;

const storageSync = browserApi.storage.sync || browserApi.storage.local;
const storageLocal = browserApi.storage.local;

async function getSettings() {
  try {
    const out = await storageSync.get([SETTINGS_KEY]);
    return out[SETTINGS_KEY] ?? {};
  } catch {
    const out = await storageLocal.get([SETTINGS_KEY]);
    return out[SETTINGS_KEY] ?? {};
  }
}

async function updateBadge(increment = false) {
  const settings = await getSettings();
  if (!settings.badgeEnabled && !increment) {
    browserApi.action.setBadgeText({ text: "" });
    return;
  }
  if (increment) {
    const out = await storageLocal.get([UNREAD_COUNT_KEY]);
    let n = (out[UNREAD_COUNT_KEY] ?? 0) + 1;
    if (n > 99) n = 99;
    await storageLocal.set({ [UNREAD_COUNT_KEY]: n });
    browserApi.action.setBadgeText({ text: String(n) });
    browserApi.action.setBadgeBackgroundColor({ color: "#9147ff" });
  }
}

async function addNotificationAndMaybeDiscord({
  message,
  channel,
  type = "Info",
}) {
  const notif = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    time: Date.now(),
    message,
    channel: channel ?? null,
    type,
  };
  const out = await storageLocal.get([NOTIFICATIONS_KEY]);
  const list = out[NOTIFICATIONS_KEY] ?? [];
  list.unshift(notif);
  if (list.length > MAX_NOTIFICATIONS) list.length = MAX_NOTIFICATIONS;
  await storageLocal.set({ [NOTIFICATIONS_KEY]: list });

  const settings = await getSettings();

  if (settings.desktopNotifications !== false) {
    try {
      const title =
        type === "Unbanned" ? "Twitch Anti-Ban — Unbanned" : "Twitch Anti-Ban";
      const body = channel ? `${message} (${channel})` : message;
      await browserApi.notifications.create(notif.id, {
        type: "basic",
        iconUrl: "images/icon128.png",
        title,
        message: body,
      });
    } catch (e) {
      console.error("Twitch Anti-Ban: desktop notification failed", e);
    }
  }

  if (settings.badgeEnabled) await updateBadge(true);

  const webhook = settings.discordWebhook?.trim();
  if (webhook && webhook.startsWith("https://discord.com/api/webhooks/")) {
    try {
      const text = channel
        ? `**${type}** — ${message} _(${channel})_`
        : `**${type}** — ${message}`;
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
    } catch (e) {
      console.error("Twitch Anti-Ban: Discord webhook failed", e);
    }
  }
}

browserApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "fetchJson") {
    (async () => {
      try {
        const res = await fetch(request.url, {
          method: request.method ?? "GET",
          headers: request.headers ?? {},
          body: request.body ?? null,
        });
        sendResponse(res.ok ? await res.json() : null);
      } catch (error) {
        console.error(
          `Twitch Anti-Ban: unable to fetch from ${request.url}:`,
          error,
        );
        sendResponse(null);
      }
    })();
    return true;
  }

  if (request.type === "fetchText") {
    (async () => {
      try {
        const res = await fetch(request.url, {
          method: request.method ?? "GET",
          headers: request.headers ?? {},
          body: request.body ?? null,
        });
        sendResponse(res.ok ? await res.text() : null);
      } catch (error) {
        console.error("Twitch Anti-Ban: unable to fetch text:", error);
        sendResponse(null);
      }
    })();
    return true;
  }

  if (request.type === "addNotification") {
    addNotificationAndMaybeDiscord({
      message: request.message,
      channel: request.channel,
      type: request.notificationType ?? "Info",
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (request.type === "clearBadge") {
    storageLocal.set({ [UNREAD_COUNT_KEY]: 0 });
    browserApi.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === "getSettings") {
    getSettings().then((s) => sendResponse(s));
    return true;
  }

  if (request.type === "setSetting") {
    getSettings()
      .then((s) => {
        s[request.key] = request.value;
        return storageSync.set({ [SETTINGS_KEY]: s });
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
