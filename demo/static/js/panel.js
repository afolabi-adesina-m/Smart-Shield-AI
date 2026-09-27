/* Single side panel: collapse to search, and map padding that clears the panel and speed widget. */

(function () {
  function padding() {
    // Default Leaflet pin is 41px tall and hangs above its coordinate.
    const markerPad = 56;
    const mapEl = document.getElementById("map");
    const mapW = mapEl ? mapEl.clientWidth : window.innerWidth;
    const mapH = mapEl ? mapEl.clientHeight : window.innerHeight;
    let left = 20;
    let top = markerPad;
    let right = 24;
    let bottom = 28;

    const panel = document.getElementById("side-panel");
    if (panel && !panel.classList.contains("is-collapsed")) {
      left = Math.round(panel.getBoundingClientRect().right) + 16;
    }

    const phoneBar = document.querySelector("#mobile-app .topbar");
    if (phoneBar) {
      top = Math.max(top, Math.round(phoneBar.getBoundingClientRect().bottom) + markerPad);
    }

    const actions = document.querySelector(".top-actions");
    if (actions && !phoneBar) {
      const box = actions.getBoundingClientRect();
      if (box.width > 0) {
        right = Math.max(right, Math.round(box.width) + 28);
        top = Math.max(top, Math.round(box.bottom) + 12);
      }
    }

    const sheet = document.getElementById("bottom-sheet");
    if (sheet) {
      bottom = Math.max(bottom, Math.round(sheet.getBoundingClientRect().height) + 20);
    }

    const speed = document.getElementById("speed-panel");
    if (speed) {
      const box = speed.getBoundingClientRect();
      if (box.height > 8 && box.top < window.innerHeight) {
        bottom = Math.max(bottom, Math.round(window.innerHeight - box.top) + 20);
      }
    }

    // Padding larger than the map flips Leaflet's center and clips the north end.
    const minFreeW = Math.min(240, Math.max(140, Math.round(mapW * 0.3)));
    const minFreeH = Math.min(220, Math.max(140, Math.round(mapH * 0.3)));
    if (left + right > mapW - minFreeW) {
      const spare = Math.max(minFreeW, mapW - minFreeW);
      const scale = spare / Math.max(1, left + right);
      left = Math.round(left * scale);
      right = Math.round(right * scale);
    }
    if (top + bottom > mapH - minFreeH) {
      const spare = Math.max(markerPad + 24, mapH - minFreeH);
      top = Math.min(top, Math.max(markerPad, Math.round(spare * 0.42)));
      bottom = Math.max(24, spare - top);
    }

    return { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom] };
  }

  window.SmartShieldMapPadding = padding;

  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("side-panel");
    const scroll = document.getElementById("panel-scroll") || document.querySelector(".sheet-scroll");
    if (panel && window.L && L.DomEvent) {
      L.DomEvent.disableScrollPropagation(panel);
      L.DomEvent.disableClickPropagation(panel);
    }
    const sheet = document.getElementById("bottom-sheet");
    if (sheet && window.L && L.DomEvent) {
      L.DomEvent.disableScrollPropagation(sheet);
      L.DomEvent.disableClickPropagation(sheet);
    }
    if (scroll) {
      scroll.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    }
    function showAction(name) {
      document.querySelectorAll(".panel-foot [data-panel-action]").forEach((btn) => {
        btn.hidden = btn.dataset.panelAction !== name;
      });
      const status = document.getElementById("status");
      if (status) status.hidden = name !== "directions";
    }
    let currentAction = "directions";
    document.querySelectorAll(".panel-section[data-panel-action]").forEach((section) => {
      section.addEventListener("toggle", () => {
        const name = section.dataset.panelAction || "directions";
        if (section.open) currentAction = name;
        else if (currentAction === name) currentAction = "directions";
        showAction(currentAction);
      });
    });
    showAction("directions");

    const button = document.getElementById("panel-collapse");
    if (!panel || !button) return;
    button.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("is-collapsed");
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      button.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
      const map = window.SmartShieldMap && window.SmartShieldMap();
      if (map) setTimeout(() => map.invalidateSize(), 40);
    });
  });
})();
