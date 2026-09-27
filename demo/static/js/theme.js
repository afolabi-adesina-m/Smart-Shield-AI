/* Light and night-driving themes, plus the map tile style that matches them. */

(function () {
  const KEY = "smartshield-theme";

  function preferred() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (err) {
      /* private mode */
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1116" : "#f3f6fb");
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const toDark = theme !== "dark";
      btn.setAttribute("aria-label", toDark ? "Switch to night theme" : "Switch to day theme");
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
    document.dispatchEvent(new CustomEvent("smartshield:theme", { detail: { theme } }));
  }

  apply(document.documentElement.getAttribute("data-theme") || preferred());

  document.addEventListener("DOMContentLoaded", () => {
    apply(document.documentElement.getAttribute("data-theme") || preferred());
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch (err) { /* ignore */ }
        apply(next);
      });
    }
    const toggle = document.getElementById("safety-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const section = document.getElementById("routes-section");
        if (section && section.closest("#safety-card")) {
          const open = section.hidden;
          section.hidden = !open;
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          return;
        }
        if (typeof setSheetState === "function") setSheetState("half");
      });
    }
  });

  window.SmartShieldTheme = {
    current() {
      return document.documentElement.getAttribute("data-theme") || "light";
    },
    tileUrl(theme) {
      return theme === "dark"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    },
  };
})();
