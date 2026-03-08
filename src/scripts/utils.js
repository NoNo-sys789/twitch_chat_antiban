const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;
const twitchColors = [
  "#FF0000",
  "#0000FF",
  "#008000",
  "#B22222",
  "#E05B5B",
  "#FF7F50",
  "#9ACD32",
  "#FF4500",
  "#2E8B57",
  "#DAA520",
  "#D2691E",
  "#5F9EA0",
  "#1E90FF",
  "#FF69B4",
  "#8A2BE2",
  "#00FF7F",
];

const BADGE_CACHE_MS = 24 * 60 * 60 * 1000;

async function fetchJson(url, method = "GET", headers = {}, body = null) {
  try {
    return await browserApi.runtime.sendMessage({
      type: "fetchJson",
      url,
      method,
      headers,
      body,
    });
  } catch (error) {
    console.log(`Twitch Anti-Ban: unable to fetch from ${url}: ${error}`);
    return null;
  }
}

async function getTwitchUserId(username) {
  const userId = await getFromStorage(String(username));
  if (userId) {
    console.log("Twitch Anti-Ban: found channel ID in local storage:", userId);
    return userId;
  }
  const data = await fetchJson(
    `https://%APIURL%/getTwitchUserId?username=${username}`,
  );
  if (data) {
    await storeToStorage(username, data);
    console.log("Twitch Anti-Ban: channel ID stored in local storage:", data);
  }
  return data;
}

async function getTwitchBadges(userId) {
  const cached = await getFromStorage(String(userId));
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < BADGE_CACHE_MS) {
      console.log(`Twitch Anti-Ban: found badges (${userId}) in local storage`);
      return data;
    }
  }
  const data = await fetchJson(
    `https://%APIURL%/getTwitchBadges?user=${userId}`,
  );
  if (data) {
    await storeToStorage(
      userId,
      JSON.stringify({ data, timestamp: Date.now() }),
    );
    console.log(
      `Twitch Anti-Ban: badges (${userId}) are stored in local storage`,
    );
  }
  return data;
}

async function getTwitchStreamPlaylist(channel) {
  try {
    return await browserApi.runtime.sendMessage({
      type: "fetchText",
      url: `https://%APIURL%/getTwitchPlaylist?channel=${channel}`,
    });
  } catch (error) {
    console.log(`Twitch Anti-Ban: unable to fetch playlist: ${error}`);
    return null;
  }
}

const getFromStorage = (key) =>
  browserApi.storage.local.get([key]).then((result) => result[key]);

const storeToStorage = (key, value) =>
  browserApi.storage.local.set({ [key]: value });

function parseIRCMessage(message) {
  const parsed = {};

  if (message.startsWith("PING")) {
    parsed.command = "PING";
    parsed.msg = message.split(" ").slice(1).join(" ");
    return parsed;
  }

  const [tags, source, command, channel, ...msg] = message.split(" ");

  if (tags.startsWith("@")) {
    for (const tag of tags.slice(1).split(";")) {
      const [key, value] = tag.split("=");
      parsed[key] = value;
    }
  }

  if (source.startsWith(":")) {
    const [nickname, user, host] = source.slice(1).split(/[!@]/);
    parsed.source = { nickname, user, host };
  }

  parsed.command = command;
  parsed.channel = channel?.slice(1);
  parsed.msg = msg.join(" ").slice(1);

  if (parsed.msg.startsWith("\x01ACTION") && parsed.msg.endsWith("\x01")) {
    parsed.action = true;
    parsed.msg = parsed.msg
      .replace(/^\x01ACTION/, "")
      .replace(/\x01$/, "")
      .trim();
  } else {
    parsed.action = false;
  }

  return parsed;
}

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
