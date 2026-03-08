const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

const NOTIFICATIONS_KEY = "twitchAntibanNotifications";
const SETTINGS_KEY = "twitchAntibanSettings";
const LAST_VERSION_KEY = "twitchAntibanLastSeenVersion";
const storageSync = browserApi.storage.sync || browserApi.storage.local;

async function getSettings() {
  try {
    const out = await storageSync.get([SETTINGS_KEY]);
    return out[SETTINGS_KEY] ?? {};
  } catch {
    const out = await browserApi.storage.local.get([SETTINGS_KEY]);
    return out[SETTINGS_KEY] ?? {};
  }
}

async function getNotifications() {
  const out = await browserApi.storage.local.get([NOTIFICATIONS_KEY]);
  return out[NOTIFICATIONS_KEY] ?? [];
}

function formatTime(ms) {
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderNotifications(list, filter) {
  const el = document.getElementById("notifications");
  el.innerHTML = "";
  const filtered =
    filter && filter !== "all"
      ? list.filter((n) => (n.type ?? "Info") === filter)
      : list;
  for (const n of filtered) {
    const div = document.createElement("div");
    div.className = "notification";
    div.innerHTML = `<span class="notification-time">${formatTime(n.time)}</span><span class="notification-type">${escapeHtml(n.type ?? "Info")}</span> — ${escapeHtml(n.message)}`;
    el.appendChild(div);
  }
}

function applyTheme(theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (theme === "light" || (theme === "system" && !prefersDark)) {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
}

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  browserApi.runtime.openOptionsPage?.() ||
    (window.location.href = "options.html");
});

document.getElementById("filter").addEventListener("change", async () => {
  const filter = document.getElementById("filter").value;
  const list = await getNotifications();
  renderNotifications(list, filter);
});

document.getElementById("clear").addEventListener("click", async () => {
  await browserApi.storage.local.set({ [NOTIFICATIONS_KEY]: [] });
  renderNotifications([]);
});

document.getElementById("export").addEventListener("click", async () => {
  const list = await getNotifications();
  const blob = new Blob([JSON.stringify(list, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `twitch-antiban-notifications-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("dismiss-upgrade")?.addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("upgrade-banner").hidden = true;
  browserApi.storage.local.set({
    [LAST_VERSION_KEY]: browserApi.runtime.getManifest().version,
  });
});

(async () => {
  browserApi.runtime.sendMessage({ type: "clearBadge" }).catch(() => {});

  const [settings, notifications, lastVersion] = await Promise.all([
    getSettings(),
    getNotifications(),
    browserApi.storage.local
      .get([LAST_VERSION_KEY])
      .then((o) => o[LAST_VERSION_KEY]),
  ]);
  applyTheme(settings.theme ?? "dark");
  const filter = document.getElementById("filter").value;
  renderNotifications(notifications, filter);

  const currentVersion = browserApi.runtime.getManifest().version;
  if (lastVersion !== currentVersion) {
    document.getElementById("upgrade-banner").hidden = false;
  }
})();
