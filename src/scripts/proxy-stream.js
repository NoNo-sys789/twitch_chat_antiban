const ProxyStream = {
  channel: null,
  hls: null,
  currentQuality: null,
  qualities: [],
  _playlistBlobUrl: null,

  convertToPlaylistBlob(playlist) {
    const blob = new Blob([playlist], {
      type: "application/vnd.apple.mpegurl",
    });
    return URL.createObjectURL(blob);
  },

  async getStreamPlaylist(channel) {
    const playlist = await getTwitchStreamPlaylist(channel);
    if (!playlist) {
      console.log("Twitch Anti-Ban: Stream is offline");
      return null;
    }
    ProxyStream.qualities = [];
    const lines = playlist.split("\n");
    for (const line of lines) {
      if (line.includes("#EXT-X-STREAM-INF:")) {
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const fpsMatch = line.match(/FRAME-RATE=([\d.]+)/);
        if (resMatch) {
          const [, height] = resMatch[1].split("x");
          let quality = `${height}p`;
          if (fpsMatch) {
            const fps = Number(fpsMatch[1]);
            if (fps > 30) quality += String(Math.round(fps));
          }
          if (!ProxyStream.qualities.includes(quality)) {
            ProxyStream.qualities.push(quality);
          }
        }
      }
    }
    ProxyStream.qualities.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    return ProxyStream.convertToPlaylistBlob(playlist);
  },

  restoreOriginalPlayer() {
    // Twitch 2024+: player-overlay-click-handler or .video-player; legacy: video-player
    const streamContainer =
      document.querySelector('[data-a-target="video-player"]') ||
      document.querySelector(
        'div[data-a-target="player-overlay-click-handler"]',
      ) ||
      document.querySelector(".video-player");
    if (streamContainer) streamContainer.style.display = "block";
    const antiBan = document.getElementById("anti-ban-stream");
    if (antiBan) antiBan.remove();
    if (ProxyStream.hls) {
      ProxyStream.hls.destroy();
      ProxyStream.hls = null;
    }
    if (ProxyStream._playlistBlobUrl) {
      URL.revokeObjectURL(ProxyStream._playlistBlobUrl);
      ProxyStream._playlistBlobUrl = null;
    }
    ProxyStream.channel = null;
  },

  createPlayerTemplate() {
    const qualityMenuItems = ProxyStream.qualities
      .map(
        (quality) =>
          `<div class="anti-ban-quality-option" data-quality="${quality}">${quality}</div>`,
      )
      .join("");

    return `
      <div id="anti-ban-stream">
        <div class="anti-ban-video-player-container">
          <video id="anti-ban-stream-player" class="anti-ban-video-player"></video>
          <div class="anti-ban-video-controls">
            <button class="anti-ban-play-pause-btn">⏵</button>
            <div class="anti-ban-volume-container">
              <button class="anti-ban-volume-btn">🔊</button>
              <input type="range" class="anti-ban-volume-slider" min="0" max="100" value="100">
            </div>
            <div class="anti-ban-quality-control">
              <button class="anti-ban-quality-selector">${ProxyStream.qualities[0] ?? "Quality"} ▾</button>
              <div class="anti-ban-quality-menu">${qualityMenuItems}</div>
            </div>
            <button class="anti-ban-fullscreen-btn">⛶</button>
          </div>
        </div>
      </div>`;
  },

  initPlayerControls() {
    const container = document.getElementById("anti-ban-stream");
    if (!container) return;
    const video = document.getElementById("anti-ban-stream-player");
    const playPauseBtn = container.querySelector(".anti-ban-play-pause-btn");
    const volumeBtn = container.querySelector(".anti-ban-volume-btn");
    const volumeSlider = container.querySelector(".anti-ban-volume-slider");
    const qualityBtn = container.querySelector(".anti-ban-quality-selector");
    const qualityMenu = container.querySelector(".anti-ban-quality-menu");
    const fullscreenBtn = container.querySelector(".anti-ban-fullscreen-btn");
    const videoContainer = container.querySelector(
      ".anti-ban-video-player-container",
    );
    const controls = container.querySelector(".anti-ban-video-controls");
    let controlsTimeout;

    const showControls = () => {
      controls?.classList.remove("inactive");
      if (controlsTimeout) clearTimeout(controlsTimeout);
      if (document.fullscreenElement) {
        controlsTimeout = setTimeout(() => {
          if (!video.paused) controls?.classList.add("inactive");
        }, 2000);
      }
    };

    container.addEventListener("mousemove", showControls);
    container.addEventListener("mouseenter", showControls);
    container.addEventListener("mouseleave", () => {
      if (document.fullscreenElement && !video.paused) {
        controls?.classList.add("inactive");
      }
    });

    playPauseBtn?.addEventListener("click", () => {
      if (video.paused) {
        if (ProxyStream.hls?.liveSyncPosition) {
          video.currentTime = ProxyStream.hls.liveSyncPosition;
        }
        video.play();
        playPauseBtn.textContent = "⏸";
      } else {
        video.pause();
        playPauseBtn.textContent = "⏵";
      }
    });

    video.addEventListener("play", () => {
      playPauseBtn.textContent = "⏸";
      if (ProxyStream.hls?.liveSyncPosition) {
        video.currentTime = ProxyStream.hls.liveSyncPosition;
      }
    });
    video.addEventListener("pause", () => {
      playPauseBtn.textContent = "⏵";
    });

    let lastVolume = 1;
    const updateVolumeSlider = (value) => {
      if (volumeSlider) {
        volumeSlider.style.background = `linear-gradient(to right, #9147ff 0%, #9147ff ${value}%, rgba(255, 255, 255, 0.2) ${value}%)`;
      }
    };
    updateVolumeSlider(100);

    volumeSlider?.addEventListener("input", (e) => {
      const value = e.target.value;
      const volume = value / 100;
      video.volume = volume;
      volumeBtn.textContent = volume === 0 ? "🔇" : "🔊";
      lastVolume = volume || 1;
      updateVolumeSlider(value);
    });

    volumeBtn?.addEventListener("click", () => {
      if (video.volume > 0) {
        video.volume = 0;
        volumeSlider.value = 0;
        volumeBtn.textContent = "🔇";
        updateVolumeSlider(0);
      } else {
        video.volume = lastVolume;
        volumeSlider.value = lastVolume * 100;
        updateVolumeSlider(lastVolume * 100);
        volumeBtn.textContent = "🔊";
      }
    });

    qualityBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = qualityMenu?.classList.contains("active");
      for (const menu of document.querySelectorAll(".anti-ban-quality-menu")) {
        menu.classList.remove("active");
      }
      if (!isVisible) qualityMenu?.classList.add("active");
    });

    qualityMenu?.querySelectorAll(".anti-ban-quality-option").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        const quality = e.currentTarget.dataset.quality;
        if (ProxyStream.hls?.levels) {
          const height = Number(quality.replace(/p.*$/, ""));
          const levelIndex = ProxyStream.hls.levels.findIndex(
            (level) => level.height === height,
          );
          if (levelIndex !== -1) {
            ProxyStream.hls.nextLevel = levelIndex;
            qualityMenu
              .querySelectorAll(".anti-ban-quality-option")
              .forEach((o) => o.classList.remove("active"));
            e.currentTarget.classList.add("active");
            qualityBtn.textContent = `${quality} ▾`;
          }
        }
        qualityMenu?.classList.remove("active");
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".anti-ban-quality-control")) {
        qualityMenu?.classList.remove("active");
      }
    });

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        videoContainer
          ?.requestFullscreen()
          .catch((err) =>
            console.log(
              `Error attempting to enable fullscreen: ${err.message}`,
            ),
          );
      } else {
        document.exitFullscreen();
      }
    };
    fullscreenBtn?.addEventListener("click", toggleFullscreen);
    video.addEventListener("dblclick", toggleFullscreen);

    document.addEventListener("fullscreenchange", () => {
      fullscreenBtn.textContent = document.fullscreenElement ? "⛶" : "⛶";
    });
  },

  initStream(channel) {
    ProxyStream.channel = channel;
    const streamContainer =
      document.querySelector('[data-a-target="video-player"]') ||
      document.querySelector(
        'div[data-a-target="player-overlay-click-handler"]',
      ) ||
      document.querySelector(".video-player");
    if (!streamContainer) return;
    streamContainer.style.display = "none";
    const parent = streamContainer.parentElement;
    if (!parent) return;

    if (!Hls.isSupported()) {
      ProxyChat.log(
        "Unable to initialize stream player. HLS is not supported in this browser.",
      );
      return;
    }

    (async () => {
      const playlist = await ProxyStream.getStreamPlaylist(channel);
      if (!playlist) {
        console.log("Twitch Anti-Ban: Stream is offline");
        parent.insertAdjacentHTML(
          "beforeend",
          `
          <div id="anti-ban-stream">
            <div class="anti-ban-video-player-container">
              <div class="anti-ban-offline-message">Stream is currently offline</div>
            </div>
          </div>`,
        );
        return;
      }

      if (ProxyStream._playlistBlobUrl) {
        URL.revokeObjectURL(ProxyStream._playlistBlobUrl);
        ProxyStream._playlistBlobUrl = null;
      }
      parent.insertAdjacentHTML(
        "beforeend",
        ProxyStream.createPlayerTemplate(),
      );
      const video = document.getElementById("anti-ban-stream-player");
      ProxyStream._playlistBlobUrl = playlist;

      ProxyStream.hls = new Hls({
        startLevel: -1,
        capLevelToPlayerSize: true,
        autoLevelCapping: -1,
      });
      ProxyStream.hls.loadSource(playlist);
      ProxyStream.hls.attachMedia(video);

      ProxyStream.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
        ProxyStream.initPlayerControls();
        if (ProxyStream.hls.levels?.length > 0) {
          const container = document.getElementById("anti-ban-stream");
          const qualityBtn = container?.querySelector(
            ".anti-ban-quality-selector",
          );
          const qualityMenu = container?.querySelector(
            ".anti-ban-quality-menu",
          );
          const maxLevel = ProxyStream.hls.levels.length - 1;
          ProxyStream.hls.currentLevel = maxLevel;
          ProxyStream.hls.nextLevel = maxLevel;
          if (qualityBtn)
            qualityBtn.textContent = `${ProxyStream.qualities[0]} ▾`;
          qualityMenu
            ?.querySelector(".anti-ban-quality-option")
            ?.classList.add("active");
        }
      });

      ProxyStream.hls.on(Hls.Events.ERROR, (event, data) => {
        if (event && data) console.log("Twitch Anti-Ban:", event, data);
      });
    })();
  },
};

window.ProxyStream = ProxyStream;
