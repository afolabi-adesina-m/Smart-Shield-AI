/**
 * Shared weather / 511 scenario picker — touch-friendly chips (desktop + mobile).
 */
const WEATHER_OPTIONS = [
  {
    value: "clear",
    icon: "☀️",
    title: "Clear",
    sub: "Summer highway",
    hint: "Typical LOW risk",
    tone: "low",
  },
  {
    value: "wet",
    icon: "🌧️",
    title: "Wet / dawn",
    sub: "Reduced grip",
    hint: "Typical MEDIUM risk",
    tone: "med",
  },
  {
    value: "blizzard",
    icon: "❄️",
    title: "Blizzard",
    sub: "Hwy 400 · night",
    hint: "Typical HIGH risk",
    tone: "high",
  },
  {
    value: "ice_storm",
    icon: "🧊",
    title: "Ice storm",
    sub: "QEW · rush hour",
    hint: "Typical HIGH risk",
    tone: "high",
  },
];

function initWeatherPicker(containerId, hiddenInputId) {
  const container = document.getElementById(containerId);
  const hidden = document.getElementById(hiddenInputId);
  if (!container || !hidden) return;

  container.innerHTML = "";
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", "Weather and 511 scenario");

  WEATHER_OPTIONS.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `weather-chip tone-${opt.tone}`;
    btn.dataset.value = opt.value;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", hidden.value === opt.value ? "true" : "false");
    btn.innerHTML = `
      <span class="weather-chip-icon" aria-hidden="true">${opt.icon}</span>
      <span class="weather-chip-text">
        <span class="weather-chip-title">${opt.title}</span>
        <span class="weather-chip-sub">${opt.sub}</span>
      </span>
      <span class="weather-chip-hint">${opt.hint}</span>
    `;

    if (hidden.value === opt.value) {
      btn.classList.add("selected");
      btn.setAttribute("aria-checked", "true");
    }

    btn.addEventListener("click", () => selectWeatherChip(container, hidden, opt.value));
    container.appendChild(btn);
  });
}

function selectWeatherChip(container, hidden, value) {
  hidden.value = value;
  container.querySelectorAll(".weather-chip").forEach((chip) => {
    const on = chip.dataset.value === value;
    chip.classList.toggle("selected", on);
    chip.setAttribute("aria-checked", on ? "true" : "false");
  });
  container.dispatchEvent(new CustomEvent("weather-change", { detail: { value } }));
}

function getWeatherLabel(value) {
  const opt = WEATHER_OPTIONS.find((o) => o.value === value);
  return opt ? `${opt.icon} ${opt.title}` : value;
}

/**
 * Shared across app.js and mobile.js: turn a scored route's
 * e_index_source / alert_source / live_weather_raw / alert_preview fields
 * into a human-readable "what actually drove this score" panel.
 */
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function dataSourceLabel(route) {
  const weatherLive = route.e_index_source === "live_weather";
  const alertLive = route.alert_source === "live_511";
  const weatherTag = weatherLive
    ? '<span class="live-tag">● Live weather</span>'
    : '<span class="fallback-tag">● Demo weather</span>';
  const alertTag = alertLive
    ? '<span class="live-tag">● Live 511</span>'
    : route.alert_source === "custom"
    ? '<span class="fallback-tag">● Custom alert</span>'
    : '<span class="fallback-tag">● Demo 511</span>';
  return `${weatherTag} · ${alertTag}`;
}

function weatherConditionsChips(raw) {
  if (!raw) return "";
  const chips = [];
  if (typeof raw.raw_temp_c === "number") {
    chips.push(`<span>🌡️ ${raw.raw_temp_c.toFixed(1)}°C</span>`);
  }
  if (raw.raw_snow_cm > 0) {
    chips.push(`<span>❄️ ${raw.raw_snow_cm.toFixed(1)} cm snow</span>`);
  }
  if (raw.raw_precip_mm > 0) {
    chips.push(`<span>🌧️ ${raw.raw_precip_mm.toFixed(1)} mm rain</span>`);
  }
  if (typeof raw.raw_wind_kmh === "number") {
    chips.push(`<span>💨 ${raw.raw_wind_kmh.toFixed(0)} km/h wind</span>`);
  }
  return chips.length ? `<div class="live-conditions">${chips.join("")}</div>` : "";
}

/**
 * Full "why this score" panel for a route card: source tags, real
 * temp/wind/precip when live weather was used, and the real 511 alert
 * text (or custom text) when it drove the NLP score.
 */
function renderLiveDetails(route) {
  const weatherLive = route.e_index_source === "live_weather";
  const alertLive = route.alert_source === "live_511";
  const isCustom = route.alert_source === "custom";

  const conditions = weatherLive ? weatherConditionsChips(route.live_weather_raw) : "";

  let alertBlock = "";
  if (alertLive || isCustom) {
    const label = alertLive ? "Live 511 alert" : "Your custom alert";
    alertBlock = `
      <div class="live-alert-quote">
        <span class="live-alert-label">${label}:</span>
        "${escapeHtml(route.alert_preview)}"
      </div>`;
  }

  const usedFallback = !weatherLive && !alertLive && !isCustom;
  const fallbackNote = usedFallback
    ? '<div class="live-fallback-note">Showing demo scenario — live weather/511 data wasn\'t available for this route.</div>'
    : "";

  return `
    <div class="live-details">
      <div class="data-source-line">${dataSourceLabel(route)}</div>
      ${conditions}
      ${alertBlock}
      ${fallbackNote}
    </div>
  `;
}
