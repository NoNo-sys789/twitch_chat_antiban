/** Parse HTML string into a single DOM element */
function parseHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

const browserApiProxyChat =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

const ProxyChat = {
  socket: null,
  channel: null,
  channelId: null,
  messages: [],
  filterText: "",
  scrollPaused: false,
  highlightUsername: "",
  minimalBranding: false,
  thirdPartyEmotes: {},
  thirdPartyEmoteCodesByPriority: [],
  badges: {},
  pingIntervalID: null,
  _updateChatIntervalId: null,
  _unbannedNoticeShown: false,

  async loadChannelData() {
    const channelId = await getTwitchUserId(ProxyChat.channel);
    if (channelId === null) {
      ProxyChat.log(
        `Unable to fetch channel ID for channel name: ${ProxyChat.channel}`,
      );
    } else {
      ProxyChat.channelId = channelId;
      await ProxyChat.loadThirdPartyEmotes();
      await ProxyChat.loadTwitchBadges();
    }
  },

  async loadTwitchBadges() {
    const [globalBadges, channelBadges] = await Promise.all([
      getTwitchBadges("global"),
      getTwitchBadges(ProxyChat.channelId),
    ]);
    ProxyChat.parseTwitchBadges(globalBadges?.data ?? []);
    ProxyChat.parseTwitchBadges(channelBadges?.data ?? []);
  },

  async loadThirdPartyEmotes() {
    ProxyChat.thirdPartyEmotes = {};
    ProxyChat.thirdPartyEmoteCodesByPriority = [];

    const [
      ffzGlobal,
      ffzChannel,
      bttvGlobal,
      bttvChannel,
      stvGlobal,
      stvChannel,
    ] = await Promise.all([
      fetchJson(
        "https://api.betterttv.net/3/cached/frankerfacez/emotes/global",
      ),
      fetchJson(
        `https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${ProxyChat.channelId}`,
      ),
      fetchJson("https://api.betterttv.net/3/cached/emotes/global"),
      fetchJson(
        `https://api.betterttv.net/3/cached/users/twitch/${ProxyChat.channelId}`,
      ),
      fetchJson("https://7tv.io/v3/emote-sets/global"),
      fetchJson(`https://7tv.io/v3/users/twitch/${ProxyChat.channelId}`),
    ]);

    for (const emote of ffzGlobal ?? []) {
      ProxyChat.thirdPartyEmotes[emote.code] = {
        id: emote.id,
        src: emote.images["4x"] ?? emote.images["2x"] ?? emote.images["1x"],
      };
    }
    for (const emote of ffzChannel ?? []) {
      ProxyChat.thirdPartyEmotes[emote.code] = {
        id: emote.id,
        src: emote.images["4x"] ?? emote.images["2x"] ?? emote.images["1x"],
      };
    }

    for (const bttvEmotes of [bttvGlobal, bttvChannel]) {
      const list = Array.isArray(bttvEmotes)
        ? bttvEmotes
        : [
            ...(bttvEmotes?.channelEmotes ?? []),
            ...(bttvEmotes?.sharedEmotes ?? []),
          ];
      for (const emote of list) {
        ProxyChat.thirdPartyEmotes[emote.code] = {
          id: emote.id,
          src: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
        };
      }
    }

    for (const stvEmotes of [stvGlobal, stvChannel]) {
      const emotes = stvEmotes?.emote_set?.emotes ?? stvEmotes?.emotes ?? [];
      for (const emote of emotes) {
        if (emote?.data?.host?.files?.length && emote.data.host.url?.trim()) {
          const files = emote.data.host.files;
          const best = files.at(-1);
          const low = files.at(0);
          ProxyChat.thirdPartyEmotes[emote.name] = {
            id: emote.id,
            src: `https:${emote.data.host.url}/${best.name}`,
            width: `${low.width / 10}rem`,
            height: `${low.height / 10}rem`,
          };
        }
      }
    }

    ProxyChat.thirdPartyEmoteCodesByPriority = Object.keys(
      ProxyChat.thirdPartyEmotes,
    ).sort((a, b) => b.length - a.length);
  },

  parseTwitchBadges(badgeData) {
    for (const badge of badgeData) {
      for (const version of badge.versions) {
        const key = `${badge.set_id}/${version.id}`;
        ProxyChat.badges[key] = {
          src1x: version.image_url_1x,
          src4x: version.image_url_4x,
        };
      }
    }
  },

  replaceTwitchEmotes(message) {
    if (!message.emotes) return message.msg;
    let msg = message.msg;
    const emoteCodes = {};

    for (const part of message.emotes.split("/")) {
      const [emoteIndex, ranges] = part.split(":");
      for (const range of ranges.split(",")) {
        const [start, end] = range.split("-");
        const emoteCode = message.msg.slice(Number(start), Number(end) + 1);
        emoteCodes[emoteCode] = {
          src: `https://static-cdn.jtvnw.net/emoticons/v2/${emoteIndex}/default/dark/3.0`,
        };
      }
    }

    for (const emote of Object.keys(emoteCodes)) {
      const emoteHtml = ProxyChat.wrapEmote(emoteCodes[emote]);
      const regex = new RegExp(`(?<!\\S)(${escapeRegExp(emote)})(?!\\S)`, "g");
      msg = msg.replace(regex, emoteHtml);
    }
    return msg;
  },

  replaceThirdPartyEmotes(msg) {
    for (const emoteCode of ProxyChat.thirdPartyEmoteCodesByPriority) {
      const emoteHtml = ProxyChat.wrapEmote(
        ProxyChat.thirdPartyEmotes[emoteCode],
      );
      const regex = new RegExp(
        `(?<!\\S)(${escapeRegExp(emoteCode)})(?!\\S)`,
        "g",
      );
      msg = msg.replace(regex, emoteHtml);
    }
    return msg;
  },

  wrapUsername(message) {
    const el = document.createElement("span");
    el.className = "chat-author__display-name";
    const color =
      message.color ??
      twitchColors[message["display-name"]?.charCodeAt(0) % 16];
    el.style.color = color;
    el.textContent = message["display-name"] ?? message.source?.nickname ?? "";
    return el;
  },

  wrapMessage(message) {
    const el = document.createElement("span");
    if (message.action) {
      const color =
        message.color ??
        twitchColors[message["display-name"]?.charCodeAt(0) % 16];
      el.style.color = color;
    }
    let msgWithEmotes = ProxyChat.replaceTwitchEmotes(message);
    msgWithEmotes = ProxyChat.replaceThirdPartyEmotes(msgWithEmotes);
    el.innerHTML = msgWithEmotes;
    return el;
  },

  wrapEmote(emote) {
    const imgStyle =
      emote.width || emote.height
        ? `style="width: ${emote.width ?? "auto"}; height: ${emote.height ?? "auto"};"`
        : "";
    return `<div class="inline-image">
      <div class="chat-image__container" ${imgStyle}>
        <img class="chat-image chat-line__message--emote" src="${emote.src}"/>
      </div>
    </div>`;
  },

  wrapBadge(badgeData) {
    return `<div class="inline-image">
      <div class="chat-badge">
        <img class="chat-image" src="${badgeData.src1x}" srcset="${badgeData.src1x} 1x, ${badgeData.src4x} 4x"/>
      </div>
    </div>`;
  },

  wrapBadges(message) {
    if (!message.badges) return [];
    return message.badges
      .split(",")
      .filter((badge) => Object.hasOwn(ProxyChat.badges, badge))
      .map((badge) => ProxyChat.wrapBadge(ProxyChat.badges[badge]));
  },

  log(message) {
    if (ProxyChat.minimalBranding) return;
    ProxyChat.writeChat({ "display-name": "Twitch Anti-Ban", msg: message });
    console.log(`Twitch Anti-Ban: ${message}`);
  },

  clearMessage(messageId) {
    setTimeout(() => {
      const el = document.querySelector(`.chat-line[data-id="${messageId}"]`);
      el?.remove();
    }, 100);
  },

  clearAllMessages(userId) {
    setTimeout(() => {
      document
        .querySelectorAll(`.chat-line[data-user-id="${userId}"]`)
        .forEach((el) => el.remove());
    }, 100);
  },

  showUnbannedNotice(channel) {
    if (ProxyChat._unbannedNoticeShown) return;
    ProxyChat._unbannedNoticeShown = true;

    const browserApi =
      typeof globalThis.browser !== "undefined"
        ? globalThis.browser
        : globalThis.chrome;
    browserApi.runtime
      .sendMessage({
        type: "addNotification",
        message:
          "You appear to be unbanned from chat. Refresh the page to use normal chat.",
        channel,
        notificationType: "Unbanned",
      })
      .catch(() => {});

    const container = document.querySelector(".chat-list--default");
    if (!container) return;
    const banner = document.createElement("div");
    banner.className = "anti-ban-unbanned-banner";
    const textSpan = document.createElement("span");
    textSpan.className = "anti-ban-unbanned-text";
    textSpan.textContent =
      "You appear to be unbanned. Refresh the page to use normal chat.";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "anti-ban-unbanned-refresh";
    refreshBtn.textContent = "Refresh";
    banner.appendChild(textSpan);
    banner.appendChild(refreshBtn);
    container.insertBefore(banner, container.firstChild);

    let refreshTimeoutId = null;
    let countdownIntervalId = null;

    const cancelAutoRefresh = () => {
      if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);
      refreshTimeoutId = null;
      countdownIntervalId = null;
      textSpan.textContent =
        "You appear to be unbanned. Refresh the page to use normal chat.";
      refreshBtn.textContent = "Refresh";
    };

    refreshBtn.addEventListener("click", () => {
      if (refreshTimeoutId) cancelAutoRefresh();
      else location.reload();
    });

    browserApi.runtime.sendMessage({ type: "getSettings" }, (settings) => {
      const s = settings ?? {};
      if (s.autoRefreshOnUnban && s.autoRefreshDelaySec) {
        const delay = Math.min(
          60,
          Math.max(3, Number(s.autoRefreshDelaySec) || 5),
        );
        let left = delay;
        textSpan.textContent = `Refreshing in ${left}s to use normal chat.`;
        refreshBtn.textContent = "Cancel";
        countdownIntervalId = setInterval(() => {
          left -= 1;
          if (left <= 0) {
            if (countdownIntervalId) clearInterval(countdownIntervalId);
            if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
            countdownIntervalId = null;
            refreshTimeoutId = null;
            location.reload();
            return;
          }
          textSpan.textContent = `Refreshing in ${left}s to use normal chat.`;
        }, 1000);
        refreshTimeoutId = setTimeout(() => {
          countdownIntervalId && clearInterval(countdownIntervalId);
          location.reload();
        }, delay * 1000);
      }
    });
  },

  initChat() {
    ProxyChat._unbannedNoticeShown = false;
    ProxyChat.filterText = "";
    ProxyChat.scrollPaused = false;
    browserApiProxyChat.runtime.sendMessage({ type: "getSettings" }, (s) => {
      const set = s ?? {};
      ProxyChat.highlightUsername = (set.highlightUsername ?? "").toLowerCase();
      ProxyChat.minimalBranding = set.minimalBranding === true;
    });
    // Twitch 2024+: section[data-test-selector="chat-room-component-layout"]; legacy: .chat-room__content
    const chatRoom =
      document.querySelector(".chat-room__content") ||
      document.querySelector(
        'section[data-test-selector="chat-room-component-layout"]',
      );
    if (!chatRoom) return;
    const chatContainer =
      chatRoom.querySelector(".chat-list--default") ||
      chatRoom.querySelector(".chat-list") ||
      chatRoom.firstElementChild;
    if (!chatContainer) return;

    chatContainer.className = "chat-list--default";
    const toolbar = document.createElement("div");
    toolbar.id = "anti-ban-chat-toolbar";
    toolbar.className = "anti-ban-chat-toolbar";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search chat…";
    searchInput.setAttribute("aria-label", "Search chat");
    searchInput.className = "anti-ban-chat-search";
    const copyAllBtn = document.createElement("button");
    copyAllBtn.type = "button";
    copyAllBtn.className = "anti-ban-copy-all";
    copyAllBtn.textContent = "Copy all";
    copyAllBtn.setAttribute("aria-label", "Copy all messages");
    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "anti-ban-pause-scroll";
    pauseBtn.textContent = "Pause";
    pauseBtn.setAttribute("aria-label", "Pause auto-scroll");
    toolbar.appendChild(searchInput);
    toolbar.appendChild(copyAllBtn);
    toolbar.appendChild(pauseBtn);
    chatContainer.appendChild(toolbar);

    const antiBanChatDiv = document.createElement("div");
    antiBanChatDiv.id = "anti-ban-chat";
    chatContainer.appendChild(antiBanChatDiv);

    searchInput.addEventListener("input", () => {
      ProxyChat.filterText = searchInput.value;
      const lines = chatContainer.querySelectorAll(".chat-line");
      const filterLower = ProxyChat.filterText.trim().toLowerCase();
      lines.forEach((line) => {
        const text = (line.dataset.messageText || "").toLowerCase();
        const show = !filterLower || text.includes(filterLower);
        line.classList.toggle("anti-ban-filtered-out", !show);
      });
    });

    copyAllBtn.addEventListener("click", () => {
      const lines = chatContainer.querySelectorAll(
        ".chat-line:not(.anti-ban-filtered-out)",
      );
      const text = Array.from(lines)
        .map((el) => el.dataset.messageText || "")
        .filter(Boolean)
        .join("\n");
      if (text)
        navigator.clipboard.writeText(text).then(() => {
          copyAllBtn.textContent = "Copied!";
          setTimeout(() => (copyAllBtn.textContent = "Copy all"), 1500);
        });
    });

    pauseBtn.addEventListener("click", () => {
      ProxyChat.scrollPaused = !ProxyChat.scrollPaused;
      pauseBtn.textContent = ProxyChat.scrollPaused ? "Resume" : "Pause";
      pauseBtn.setAttribute(
        "aria-label",
        ProxyChat.scrollPaused ? "Resume auto-scroll" : "Pause auto-scroll",
      );
    });

    chatContainer.addEventListener("click", (e) => {
      const copyLine = e.target.closest(".anti-ban-copy-line");
      if (copyLine) {
        const line = copyLine.closest(".chat-line");
        if (line?.dataset.messageText)
          navigator.clipboard.writeText(line.dataset.messageText);
      }
    });

    const chatPaused = parseHtml(
      '<div class="anti-ban-chat-paused"><span>Scroll Down</span></div>',
    );
    chatContainer.appendChild(chatPaused);
    chatContainer.style.cssText = "display: block !important";

    if (!ProxyChat._updateChatIntervalId) {
      ProxyChat._updateChatIntervalId = setInterval(
        () => ProxyChat._runUpdateChat(),
        200,
      );
    }

    chatPaused.addEventListener("click", () => {
      const list = document.querySelector(".chat-list--default");
      if (list) {
        list.scrollTop = list.scrollHeight - list.clientHeight;
      }
      document
        .querySelectorAll(".anti-ban-chat-paused")
        .forEach((el) => (el.style.display = "none"));
    });
    chatPaused.style.display = "none";
  },

  _runUpdateChat() {
    if (ProxyChat.messages.length === 0) return;
    const chatContainer = document.querySelector(".chat-list--default");
    const antiBanChat = document.getElementById("anti-ban-chat");
    if (!chatContainer || !antiBanChat) return;

    const filterLower = ProxyChat.filterText.trim().toLowerCase();
    for (const item of ProxyChat.messages) {
      if (filterLower && !item.searchText.includes(filterLower)) continue;

      const scrollHeight = chatContainer.scrollHeight;
      const innerHeight = chatContainer.clientHeight;
      const scrollTop = chatContainer.scrollTop;
      const isScrolledNearBottom =
        scrollHeight - innerHeight <= scrollTop + innerHeight * 0.2;

      antiBanChat.insertAdjacentHTML("beforeend", item.html);
      if (!ProxyChat.scrollPaused && isScrolledNearBottom) {
        chatContainer.scrollTop = scrollHeight - innerHeight;
        document
          .querySelectorAll(".anti-ban-chat-paused")
          .forEach((el) => (el.style.display = "none"));
      } else {
        document
          .querySelectorAll(".anti-ban-chat-paused")
          .forEach((el) => (el.style.display = ""));
      }
    }
    ProxyChat.messages = [];

    const lines = chatContainer.querySelectorAll(".chat-line");
    if (lines.length > 200) {
      for (let i = 0; i < lines.length - 200; i++) {
        lines[i].remove();
      }
    }
  },

  writeChat(message) {
    const displayName =
      (message["display-name"] ?? message.source?.nickname ?? "").trim() || "";
    const msgText = (message.msg ?? "").trim();
    const searchText = `${displayName} ${msgText}`.toLowerCase();

    const chatLine = document.createElement("div");
    chatLine.className = "chat-line chat-line__message";
    chatLine.dataset.userId = message["user-id"];
    chatLine.dataset.id = message.id;
    chatLine.dataset.messageText = `${displayName}: ${msgText}`;
    if (
      ProxyChat.highlightUsername &&
      searchText.includes(ProxyChat.highlightUsername.toLowerCase())
    ) {
      chatLine.classList.add("anti-ban-highlight-mention");
    }

    const userInfo = document.createElement("span");
    for (const badgeHtml of ProxyChat.wrapBadges(message)) {
      userInfo.appendChild(parseHtml(badgeHtml));
    }
    userInfo.appendChild(ProxyChat.wrapUsername(message));
    const colon = document.createElement("span");
    if (message.action) {
      colon.innerHTML = "&nbsp;";
    } else {
      colon.className = "colon";
      colon.textContent = ": ";
    }
    userInfo.appendChild(colon);
    chatLine.appendChild(userInfo);
    chatLine.appendChild(ProxyChat.wrapMessage(message));

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "anti-ban-copy-line";
    copyBtn.title = "Copy message";
    copyBtn.setAttribute("aria-label", "Copy message");
    copyBtn.textContent = "⎘";
    chatLine.appendChild(copyBtn);

    const wrapper = document.createElement("div");
    wrapper.appendChild(chatLine);
    ProxyChat.messages.push({ html: wrapper.innerHTML, searchText });
  },

  connect(channel) {
    if (ProxyChat.socket) {
      ProxyChat.socket.onclose = () => {};
      ProxyChat.disconnect();
    }
    ProxyChat.channel = channel.toLowerCase();

    let disconnectTimeout;
    let lastDisconnectedTime = null;
    const reconnectionThreshold = 5000;

    ProxyChat.loadChannelData().then(() => {
      if (!ProxyChat.channelId) return;
      if (!ProxyChat._updateChatIntervalId) {
        ProxyChat._updateChatIntervalId = setInterval(
          () => ProxyChat._runUpdateChat(),
          200,
        );
      }
      ProxyChat.log("Connecting to chat server...");
      ProxyChat.socket = new ReconnectingWebSocket(
        "wss://irc-ws.chat.twitch.tv",
        "irc",
        { reconnectInterval: 2000 },
      );

      ProxyChat.socket.onopen = () => {
        clearTimeout(disconnectTimeout);
        if (
          lastDisconnectedTime === null ||
          Date.now() - lastDisconnectedTime > reconnectionThreshold
        ) {
          ProxyChat.log(`Connected to #${ProxyChat.channel}`);
        }
        ProxyChat.socket.send("PASS pass\r\n");
        ProxyChat.socket.send(
          `NICK justinfan${Math.floor(Math.random() * 999_999)}\r\n`,
        );
        ProxyChat.socket.send("CAP REQ :twitch.tv/commands twitch.tv/tags\r\n");
        ProxyChat.socket.send(`JOIN #${ProxyChat.channel}\r\n`);

        clearInterval(ProxyChat.pingIntervalID);
        ProxyChat.pingIntervalID = setInterval(
          () => ProxyChat.socket.send("PING\r\n"),
          4 * 60 * 1000,
        );
      };

      ProxyChat.socket.ontimeout = () => {
        ProxyChat.log("Connection timeout, reconnecting...");
      };

      ProxyChat.socket.onclose = () => {
        clearInterval(ProxyChat.pingIntervalID);
        lastDisconnectedTime = Date.now();
        disconnectTimeout = setTimeout(
          () => ProxyChat.log("Disconnected"),
          reconnectionThreshold,
        );
      };

      ProxyChat.socket.onmessage = (data) => {
        for (const line of data.data.split("\r\n")) {
          if (!line) continue;
          const message = parseIRCMessage(line);

          switch (message.command) {
            case "PING":
              ProxyChat.socket.send(`PONG ${message.msg}\r\n`);
              break;
            case "JOIN":
              ProxyChat.log(`Joined channel: ${ProxyChat.channel}`);
              break;
            case "CLEARMSG":
              if (message["target-msg-id"])
                ProxyChat.clearMessage(message["target-msg-id"]);
              break;
            case "CLEARCHAT":
              if (message["target-user-id"])
                ProxyChat.clearAllMessages(message["target-user-id"]);
              break;
            case "PRIVMSG":
              if (
                message.channel?.toLowerCase() !== ProxyChat.channel ||
                !message.msg
              )
                break;
              ProxyChat.writeChat(message);
              break;
          }
        }
      };
    });
  },

  disconnect() {
    if (ProxyChat.socket) {
      ProxyChat.socket.close();
      ProxyChat.socket = null;
    }
    if (ProxyChat.pingIntervalID) {
      clearInterval(ProxyChat.pingIntervalID);
      ProxyChat.pingIntervalID = null;
    }
    if (ProxyChat._updateChatIntervalId) {
      clearInterval(ProxyChat._updateChatIntervalId);
      ProxyChat._updateChatIntervalId = null;
    }
  },
};

window.ProxyChat = ProxyChat;
