/* Single side panel: collapse to search, and map padding that clears the panel and speed widget. */

(function () {
  function padding() {
    const panel = document.getElementById("side-panel");
    let left = 24;
    const top = 16;
    if (panel && !panel.classList.contains("is-collapsed")) {
      left = Math.round(panel.getBoundingClientRect().width) + 28;
    }
    const sheet = document.getElementById("bottom-sheet");
    let bottom = 40;
    let right = 72;
    if (sheet) {
      bottom = Math.round(sheet.getBoundingClientRect().height) + 20;
    }
    const speed = document.getElementById("speed-panel");
    if (speed) {
      const box = speed.getBoundingClientRect();
      right = Math.max(right, Math.round(box.width) + 28);
      bottom = Math.max(bottom, Math.round(window.innerHeight - box.top) + 16);
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
