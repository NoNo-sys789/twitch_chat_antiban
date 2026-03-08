const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;
const SETTINGS_KEY = "twitchAntibanSettings";
const storage = browserApi.storage.sync || browserApi.storage.local;

const defaultSettings = {
  discordWebhook: "",
  desktopNotifications: true,
  badgeEnabled: true,
  autoRefreshOnUnban: false,
  autoRefreshDelaySec: 5,
  theme: "dark",
  lastQuality: null,
  pauseDetection: false,
  banCheckThreshold: 3,
  alwaysProxyChannels: "",
  neverProxyChannels: "",
  highlightUsername: "",
  soundOnNotification: false,
  minimalBranding: false,
};

function parseChannels(str) {
  return (str ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function load() {
  const out = await storage.get([SETTINGS_KEY]);
  const s = { ...defaultSettings, ...out[SETTINGS_KEY] };
  document.getElementById("webhook").value = s.discordWebhook ?? "";
  document.getElementById("desktopNotifications").checked =
    s.desktopNotifications !== false;
  document.getElementById("badgeEnabled").checked = s.badgeEnabled !== false;
  document.getElementById("autoRefreshOnUnban").checked =
    s.autoRefreshOnUnban === true;
  document.getElementById("autoRefreshDelaySec").value =
    s.autoRefreshDelaySec ?? 5;
  document.getElementById("theme").value = s.theme ?? "dark";
  document.getElementById("pauseDetection").checked = s.pauseDetection === true;
  document.getElementById("banCheckThreshold").value = Math.min(
    10,
    Math.max(2, s.banCheckThreshold ?? 3),
  );
  document.getElementById("alwaysProxyChannels").value = Array.isArray(
    s.alwaysProxyChannels,
  )
    ? s.alwaysProxyChannels.join(", ")
    : (s.alwaysProxyChannels ?? "");
  document.getElementById("neverProxyChannels").value = Array.isArray(
    s.neverProxyChannels,
  )
    ? s.neverProxyChannels.join(", ")
    : (s.neverProxyChannels ?? "");
  document.getElementById("highlightUsername").value =
    s.highlightUsername ?? "";
  document.getElementById("soundOnNotification").checked =
    s.soundOnNotification === true;
  document.getElementById("minimalBranding").checked =
    s.minimalBranding === true;
}

document.getElementById("save").addEventListener("click", async () => {
  const delay = Math.min(
    60,
    Math.max(
      3,
      parseInt(document.getElementById("autoRefreshDelaySec").value, 10) || 5,
    ),
  );
  const threshold = Math.min(
    10,
    Math.max(
      2,
      parseInt(document.getElementById("banCheckThreshold").value, 10) || 3,
    ),
  );
  const existing = await storage
    .get([SETTINGS_KEY])
    .then((o) => o[SETTINGS_KEY] ?? {});
  const settings = {
    ...defaultSettings,
    ...existing,
    discordWebhook: document.getElementById("webhook").value.trim(),
    desktopNotifications: document.getElementById("desktopNotifications")
      .checked,
    badgeEnabled: document.getElementById("badgeEnabled").checked,
    autoRefreshOnUnban: document.getElementById("autoRefreshOnUnban").checked,
    autoRefreshDelaySec: delay,
    theme: document.getElementById("theme").value,
    pauseDetection: document.getElementById("pauseDetection").checked,
    banCheckThreshold: threshold,
    alwaysProxyChannels: parseChannels(
      document.getElementById("alwaysProxyChannels").value,
    ),
    neverProxyChannels: parseChannels(
      document.getElementById("neverProxyChannels").value,
    ),
    highlightUsername: document
      .getElementById("highlightUsername")
      .value.trim()
      .toLowerCase(),
    soundOnNotification: document.getElementById("soundOnNotification").checked,
    minimalBranding: document.getElementById("minimalBranding").checked,
  };
  await storage.set({ [SETTINGS_KEY]: settings });
  document.getElementById("autoRefreshDelaySec").value = delay;
  document.getElementById("banCheckThreshold").value = threshold;
  const status = document.getElementById("save-status");
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

load();
