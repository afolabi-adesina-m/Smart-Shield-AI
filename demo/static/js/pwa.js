/* Install prompt for the home-screen app, and a note when the API cannot be reached. */

(function () {
  function note() {
    let el = document.getElementById("offline-note");
    if (el) return el;
    el = document.createElement("div");
    el.id = "offline-note";
    el.className = "offline-note";
    el.setAttribute("role", "status");
    el.hidden = true;
    el.textContent = "You're offline. Routes and speeds need a connection.";
    document.body.appendChild(el);
    return el;
  }

  function showOffline() {
    document.body.classList.add("is-offline");
    note().hidden = false;
  }

  function hideOffline() {
    document.body.classList.remove("is-offline");
    const el = document.getElementById("offline-note");
    if (el) el.hidden = true;
  }

  function isApi(input) {
    const raw = typeof input === "string" ? input : (input && input.url) || "";
    try {
      const url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin && url.pathname.startsWith("/api/");
    } catch (err) {
      return false;
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const api = isApi(input);
    return nativeFetch(input, init).then((response) => {
      if (api && response && response.ok) hideOffline();
      return response;
    }).catch((err) => {
      if (api && (!err || err.name !== "AbortError")) showOffline();
      throw err;
    });
  };

  window.addEventListener("offline", showOffline);
  window.addEventListener("online", () => {
    if (navigator.onLine) hideOffline();
  });

  function register() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* A missed worker still leaves the page usable online. */
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!navigator.onLine) showOffline();
      register();
    });
  } else {
    if (!navigator.onLine) showOffline();
    register();
  }
})();
