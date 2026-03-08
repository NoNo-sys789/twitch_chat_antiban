const banChecks = [];
const streamBanChecks = [];

const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

function getSettings() {
  return new Promise((resolve) => {
    browserApi.runtime.sendMessage({ type: "getSettings" }, (r) =>
      resolve(r ?? {}),
    );
  });
}

function notify(message, channel, notificationType = "Info") {
  getSettings().then((s) => {
    if (s.soundOnNotification) playNotificationBeep();
  });
  browserApi.runtime
    .sendMessage({
      type: "addNotification",
      message,
      channel,
      notificationType,
    })
    .catch(() => {});
}

function playNotificationBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (_) {}
}

const CHAT_BAN_SELECTOR = [
  '[data-test-selector="banned-user-message"]',
  '[data-test-selector="request-unban-link"]',
  '[data-test-selector="cooldown-text"]',
  ".banned-chat-overlay__halt",
  ".banned-chat-overlay__circle",
].join(",");
const STREAM_BAN_SELECTOR = [
  '[data-a-target="player-overlay-content-gate"]',
  ".content-overlay-gate",
  ".content-overlay-icon",
  ".content-overlay-gate__content",
].join(",");

const exists = (selector) => document.querySelector(selector) !== null;

function checkTwitchLayout() {
  const now = Date.now();
  banChecks.push({ time: now, value: isBanned() });
  streamBanChecks.push({ time: now, value: isStreamBanned() });

  const threshold = now - 3000;
  while (banChecks.length && banChecks[0].time < threshold) banChecks.shift();
  while (streamBanChecks.length && streamBanChecks[0].time < threshold)
    streamBanChecks.shift();
}

const isBanned = () => document.querySelectorAll(CHAT_BAN_SELECTOR).length > 0;
const isStreamBanned = () =>
  document.querySelectorAll(STREAM_BAN_SELECTOR).length > 0;

function isBannedConsistent(threshold = 3) {
  const recent = banChecks.slice(-threshold);
  return recent.length >= threshold && recent.every((c) => c.value);
}
function isStreamBannedConsistent(threshold = 3) {
  const recent = streamBanChecks.slice(-threshold);
  return recent.length >= threshold && recent.every((c) => c.value);
}
const isUnbannedConsistent = () =>
  banChecks.length >= 3 && banChecks.every((c) => !c.value);
const isStreamUnbannedConsistent = () =>
  streamBanChecks.length >= 3 && streamBanChecks.every((c) => !c.value);

function getChannel() {
  const search = location.search.slice(1);
  if (search) {
    const params = Object.fromEntries(
      search
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const [key, value] = pair.split("=");
          return [key, value ?? ""];
        }),
    );
    if (params.channel) {
      const channel = decodeURIComponent(params.channel);
      return channel || null;
    }
  }

  const segment = location.pathname
    .split("/")
    .find((s) => s && s !== "popout" && s !== "chat" && s !== "embed");
  return segment ?? null;
}

function run() {
  setInterval(async () => {
    const currentChannel = getChannel();
    if (!currentChannel) return;

    const settings = await getSettings();
    const pauseDetection = settings.pauseDetection === true;
    const threshold = Math.min(
      10,
      Math.max(2, Number(settings.banCheckThreshold) || 3),
    );
    const alwaysProxy = Array.isArray(settings.alwaysProxyChannels)
      ? settings.alwaysProxyChannels
      : [];
    const neverProxy = Array.isArray(settings.neverProxyChannels)
      ? settings.neverProxyChannels
      : [];
    const channelLower = currentChannel.toLowerCase();
    const forceChatProxy = alwaysProxy.includes(channelLower);
    const forceStreamProxy = alwaysProxy.includes(channelLower);
    const skipChatProxy = neverProxy.includes(channelLower);
    const skipStreamProxy = neverProxy.includes(channelLower);

    const proxyChatActive = exists("#anti-ban-chat");
    const proxyStreamActive = exists("#anti-ban-stream");
    const stable =
      proxyChatActive &&
      proxyStreamActive &&
      ProxyStream.channel === currentChannel;

    if (!stable || proxyChatActive || proxyStreamActive) checkTwitchLayout();

    const chatShouldProxy =
      !pauseDetection &&
      !skipChatProxy &&
      (forceChatProxy || isBannedConsistent(threshold));
    const streamShouldProxy =
      !pauseDetection &&
      !skipStreamProxy &&
      (forceStreamProxy || isStreamBannedConsistent(threshold));

    if (chatShouldProxy && !proxyChatActive) {
      console.log("Twitch Anti-Ban: loading proxy chat");
      notify(
        "Proxy chat enabled (you are chat-banned).",
        currentChannel,
        "Proxy chat",
      );
      ProxyChat.initChat();
      ProxyChat.connect(currentChannel);
    }

    if (streamShouldProxy && !proxyStreamActive) {
      console.log("Twitch Anti-Ban: loading proxy stream");
      notify(
        "Proxy stream enabled (you are stream-banned).",
        currentChannel,
        "Proxy stream",
      );
      ProxyStream.restoreOriginalPlayer();
      ProxyStream.initStream(currentChannel);
    }

    if (
      proxyStreamActive &&
      isStreamUnbannedConsistent() &&
      !forceStreamProxy
    ) {
      console.log(
        "Twitch Anti-Ban: stream unbanned, restoring original player",
      );
      notify(
        "You appear to be unbanned from the stream. Restored original player.",
        currentChannel,
        "Unbanned",
      );
      ProxyStream.restoreOriginalPlayer();
    }

    if (proxyChatActive && isUnbannedConsistent() && !forceChatProxy) {
      ProxyChat.showUnbannedNotice(currentChannel);
    }

    if (ProxyStream.channel && ProxyStream.channel !== currentChannel) {
      console.log("Twitch Anti-Ban: restoring original player");
      ProxyStream.restoreOriginalPlayer();
    }
  }, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
