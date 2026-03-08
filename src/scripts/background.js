const browserApi =
  typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

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
});
