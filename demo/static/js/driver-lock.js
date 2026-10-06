/* Block address typing while a drive or motorcycle trip is moving. */

(function () {
  const PASSENGER_KEY = "smartshield.passenger.v1";
  const FIELDS = "#origin, #destination, #map-search-input, #nav-report-layer input, #nav-report-layer textarea";

  function passenger() {
    try { return sessionStorage.getItem(PASSENGER_KEY) === "1"; }
    catch (err) { return false; }
  }

  function locked() {
    if (!window.NavProgress || typeof window.NavProgress.typingLocked !== "function") return false;
    const mode = (document.body && document.body.dataset.travel) || "drive";
    const navigating = document.body.classList.contains("is-navigating");
    return window.NavProgress.typingLocked(window.SmartShieldSpeedKmh, mode, navigating, passenger());
  }

  function note() {
    let box = document.getElementById("driver-lock");
    if (!box) {
      box = document.createElement("div");
      box.id = "driver-lock";
      box.className = "driver-lock";
      box.hidden = true;
      box.innerHTML = 'Pull over to search. <button type="button" id="driver-passenger">I\'m a passenger</button>';
      document.body.appendChild(box);
      box.querySelector("#driver-passenger").addEventListener("click", () => {
        try { sessionStorage.setItem(PASSENGER_KEY, "1"); } catch (err) { /* ignore */ }
        apply();
      });
    }
    return box;
  }

  function apply() {
    const on = locked();
    document.querySelectorAll(FIELDS).forEach((field) => {
      field.readOnly = on;
      field.setAttribute("aria-disabled", on ? "true" : "false");
      if (on && document.activeElement === field) field.blur();
    });
    const box = note();
    box.hidden = !on;
  }

  document.addEventListener("smartshield:road", (event) => {
    const detail = event.detail || {};
    if (detail.current_kmh != null) window.SmartShieldSpeedKmh = detail.current_kmh;
    apply();
  });
  document.addEventListener("smartshield:start-nav", apply);
  document.addEventListener("smartshield:clear-nav", () => {
    window.SmartShieldSpeedKmh = null;
    try { sessionStorage.removeItem(PASSENGER_KEY); } catch (err) { /* ignore */ }
    apply();
  });
  document.addEventListener("focusin", (event) => {
    if (!locked()) return;
    const field = event.target;
    if (!field || !field.matches || !field.matches(FIELDS)) return;
    field.blur();
    note().hidden = false;
  });
  document.addEventListener("click", (event) => {
    if (!locked()) return;
    const target = event.target && event.target.closest && event.target.closest(
      "#nav-search, #nav-search-pill, #nav-where, #map-directions"
    );
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    note().hidden = false;
  }, true);
  document.addEventListener("DOMContentLoaded", apply);
  window.SmartShieldDriverLock = { apply: apply, locked: locked };
})();
