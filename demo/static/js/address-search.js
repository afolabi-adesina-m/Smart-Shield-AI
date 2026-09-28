/* Address autocomplete. Debounced 300 ms, at least 3 characters. */

const SUGGEST_MIN = 3;
const SUGGEST_WAIT_MS = 300;
let suggestUid = 0;

function initAddressSearch() {
  const origin = document.getElementById("origin");
  const destination = document.getElementById("destination");
  if (origin) attachAddressField(origin, { assign: "origin" });
  if (destination) attachAddressField(destination, { assign: "destination" });
  mountMapSearch();
}

function mountMapSearch() {
  const host = document.getElementById("search-slot")
    || document.getElementById("map-wrap")
    || document.getElementById("map-stage");
  if (!host || document.getElementById("map-search")) return;
  const box = document.createElement("div");
  box.id = "map-search";
  box.className = "map-search";
  box.innerHTML = `
    <svg class="icon search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <input id="map-search-input" type="search" enterkeyhint="search"
      placeholder="Search an address or place" aria-label="Search an address or place" />
    <button type="button" id="map-directions" class="map-directions">Directions</button>
    <div id="map-search-assign" class="address-assign" hidden>
      <button type="button" data-assign="origin">Set as From</button>
      <button type="button" data-assign="destination">Set as To</button>
    </div>
  `;
  host.appendChild(box);
  const input = box.querySelector("input");
  const assign = box.querySelector(".address-assign");
  const field = attachAddressField(input, {
    assign: null,
    onPick(place) {
      assign.hidden = false;
      assign.dataset.label = place.label;
      assign.dataset.lat = place.lat;
      assign.dataset.lon = place.lon;
    },
  });
  const directions = box.querySelector("#map-directions");
  if (directions) {
    directions.addEventListener("click", () => {
      const section = document.querySelector('.panel-section[data-panel-action="directions"]');
      if (section) section.open = true;
      const panel = document.getElementById("side-panel");
      if (panel) {
        panel.classList.remove("is-collapsed");
        panel.classList.add("is-open");
      }
      const sheet = document.getElementById("bottom-sheet");
      if (sheet && typeof setSheetState === "function") setSheetState("half");
      const dest = document.getElementById("destination");
      if (dest) dest.focus();
    });
  }
  assign.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-assign]");
    if (!btn) return;
    const place = {
      label: assign.dataset.label,
      lat: Number(assign.dataset.lat),
      lon: Number(assign.dataset.lon),
    };
    if (!place.label || Number.isNaN(place.lat)) return;
    writeEndpoint(btn.dataset.assign, place);
    focusPlace(place);
    field.close();
  });
}

function writeEndpoint(which, place) {
  const input = document.getElementById(which === "destination" ? "destination" : "origin");
  if (!input) return;
  input.value = place.label;
  input.dataset.lat = String(place.lat);
  input.dataset.lon = String(place.lon);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = (which === "destination" ? "To" : "From") + " set to " + place.label;
  }
}

function focusPlace(place) {
  document.dispatchEvent(new CustomEvent("smartshield:focus", {
    detail: {
      lat: Number(place.lat),
      lon: Number(place.lon),
      label: place.label,
    },
  }));
}

function attachAddressField(input, options) {
  const uid = "suggest-" + (++suggestUid);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", uid);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");

  if (!input.parentElement.classList.contains("address-field") && input.id !== "map-search-input") {
    const wrap = document.createElement("div");
    wrap.className = "address-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const list = document.createElement("ul");
  list.id = uid;
  list.className = "address-suggest";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  document.body.appendChild(list);

  const state = {
    items: [],
    active: -1,
    timer: null,
    controller: null,
    open: false,
  };

  function placeList() {
    const rect = input.getBoundingClientRect();
    const hud = document.getElementById("speed-panel");
    const foot = document.querySelector(".panel-foot, .sheet-foot");
    let limitBottom = window.innerHeight - 16;
    if (hud) limitBottom = Math.min(limitBottom, hud.getBoundingClientRect().top - 12);
    if (foot) limitBottom = Math.min(limitBottom, foot.getBoundingClientRect().top - 8);
    const below = limitBottom - rect.bottom - 8;
    list.style.left = Math.max(8, rect.left) + "px";
    list.style.width = Math.max(180, rect.width) + "px";
    if (below >= 96) {
      list.style.top = (rect.bottom + 4) + "px";
      list.style.maxHeight = Math.min(320, below) + "px";
      return;
    }
    const above = Math.max(96, Math.min(280, rect.top - 12));
    list.style.maxHeight = above + "px";
    list.style.top = Math.max(8, rect.top - above - 4) + "px";
  }

  function close() {
    state.open = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    state.active = -1;
    if (![...document.querySelectorAll(".address-suggest")].some((el) => !el.hidden)) {
      document.body.classList.remove("suggest-open");
    }
  }

  function open() {
    state.open = true;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    placeList();
    document.body.classList.add("suggest-open");
    requestAnimationFrame(() => {
      const height = Math.ceil(list.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--suggest-push", (height + 12) + "px");
    });
  }

  function render(message) {
    list.innerHTML = "";
    if (message) {
      const li = document.createElement("li");
      li.className = "suggest-status";
      li.textContent = message;
      list.appendChild(li);
      open();
      return;
    }
    state.items.forEach((item, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = uid + "-opt-" + index;
      li.setAttribute("aria-selected", index === state.active ? "true" : "false");
      const label = document.createElement("span");
      label.className = "sug-label";
      label.textContent = item.label;
      const detail = document.createElement("span");
      detail.className = "sug-detail";
      detail.textContent = item.detail || "";
      li.appendChild(label);
      if (item.detail) li.appendChild(detail);
      li.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        choose(index);
      });
      list.appendChild(li);
    });
    if (!state.items.length) {
      close();
      return;
    }
    open();
    highlight(state.active >= 0 ? state.active : 0);
  }

  function highlight(index) {
    if (!state.items.length) return;
    state.active = (index + state.items.length) % state.items.length;
    list.querySelectorAll("[role='option']").forEach((el, i) => {
      const on = i === state.active;
      el.setAttribute("aria-selected", on ? "true" : "false");
      el.classList.toggle("active", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    const current = document.getElementById(uid + "-opt-" + state.active);
    if (current) input.setAttribute("aria-activedescendant", current.id);
  }

  function choose(index) {
    const item = state.items[index];
    if (!item) return;
    input.value = item.label;
    close();
    resolveAndGo(item, options);
  }

  async function fetchSuggest(query) {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const center = window.SmartShieldMapCenter ? window.SmartShieldMapCenter() : null;
    const params = new URLSearchParams({ q: query });
    if (center) {
      params.set("lat", String(center.lat));
      params.set("lon", String(center.lon));
    }
    render("Searching…");
    try {
      const resp = await fetch("/api/suggest?" + params.toString(), { signal: state.controller.signal });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Search failed");
      if (input.value.trim() !== query) return;
      state.items = data.suggestions || [];
      state.active = 0;
      if (!state.items.length) render("No matching places");
      else render();
    } catch (err) {
      if (err.name === "AbortError") return;
      render(err.message || "Search failed");
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    const query = input.value.trim();
    if (query.length < SUGGEST_MIN) {
      close();
      state.items = [];
      return;
    }
    state.timer = setTimeout(() => fetchSuggest(query), SUGGEST_WAIT_MS);
  }

  input.addEventListener("input", () => {
    delete input.dataset.lat;
    delete input.dataset.lon;
    schedule();
  });
  input.addEventListener("focus", () => {
    if (state.items.length && input.value.trim().length >= SUGGEST_MIN) open();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!state.open) schedule();
      else highlight(state.active + 1);
    } else if (e.key === "ArrowUp") {
      if (!state.open) return;
      e.preventDefault();
      highlight(state.active - 1);
    } else if (e.key === "Enter") {
      if (!state.open || state.active < 0) return;
      e.preventDefault();
      choose(state.active);
    } else if (e.key === "Escape") {
      if (!state.open) return;
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!list.contains(document.activeElement)) close();
    }, 180);
  });
  window.addEventListener("scroll", () => { if (state.open) placeList(); }, true);
  window.addEventListener("resize", () => { if (state.open) placeList(); });
  document.addEventListener("pointerdown", (e) => {
    if (e.target === input || list.contains(e.target)) return;
    const box = document.getElementById("map-search");
    if (box && box.contains(e.target)) return;
    close();
  });
  document.addEventListener("smartshield:start-nav", close);
  document.addEventListener("smartshield:close-suggest", close);

  return { close };
}

async function resolveAndGo(item, options) {
  let place = item;
  if (place.lat == null || place.lon == null) {
    const resp = await fetch("/api/place?id=" + encodeURIComponent(place.id || ""));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Could not locate that place");
    place = data;
  }
  if (options.assign) writeEndpoint(options.assign, place);
  else if (options.onPick) options.onPick(place);
  if (place.lat != null && place.lon != null) focusPlace(place);
}

document.addEventListener("DOMContentLoaded", initAddressSearch);
