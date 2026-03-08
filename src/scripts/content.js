const banChecks = [];
const streamBanChecks = [];

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
const isBannedConsistent = () => banChecks.filter((c) => c.value).length >= 3;
const isStreamBannedConsistent = () =>
  streamBanChecks.filter((c) => c.value).length >= 3;

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
  setInterval(() => {
    const currentChannel = getChannel();
    if (!currentChannel) return;

    const proxyChatActive = exists("#anti-ban-chat");
    const proxyStreamActive = exists("#anti-ban-stream");
    const stable =
      proxyChatActive &&
      proxyStreamActive &&
      ProxyStream.channel === currentChannel;

    if (!stable) checkTwitchLayout();

    if (isBannedConsistent() && !proxyChatActive) {
      console.log("Twitch Anti-Ban: loading proxy chat");
      ProxyChat.initChat();
      ProxyChat.connect(currentChannel);
    }

    if (isStreamBannedConsistent() && !proxyStreamActive) {
      console.log("Twitch Anti-Ban: loading proxy stream");
      ProxyStream.restoreOriginalPlayer();
      ProxyStream.initStream(currentChannel);
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
