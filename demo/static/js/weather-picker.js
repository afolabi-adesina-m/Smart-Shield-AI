/**
 * Weather / road-conditions helpers.
 * Default is Auto (live) — set in the HTML <select id="weather">.
 */
const WEATHER_OPTIONS = [
  { value: "auto", title: "Auto (live)", sub: "Open-Meteo at route midpoint" },
  { value: "clear", title: "Clear", sub: "Dry pavement" },
  { value: "wet", title: "Wet / rain", sub: "Reduced grip" },
  { value: "blizzard", title: "Blizzard", sub: "Snow / low visibility" },
  { value: "ice_storm", title: "Ice storm", sub: "Freezing rain" },
];

/**
 * Bind the native #weather <select>. Keeps Auto (live) as default.
 * containerId is ignored when a real <select id="weather"> already exists.
 */
function initWeatherPicker(_containerId, selectId) {
  const select = document.getElementById(selectId || "weather");
  if (!select || select.tagName !== "SELECT") return;

  if (!select.value) select.value = "auto";

  select.addEventListener("change", () => {
    select.dispatchEvent(
      new CustomEvent("weather-change", { detail: { value: select.value }, bubbles: true })
    );
  });
}

function getWeatherLabel(value) {
  const opt = WEATHER_OPTIONS.find((o) => o.value === value);
  return opt ? opt.title : value;
}

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
    chips.push(`<span>${raw.raw_temp_c.toFixed(1)}°C</span>`);
  }
  if (raw.raw_snow_cm > 0) {
    chips.push(`<span>${raw.raw_snow_cm.toFixed(1)} cm snow</span>`);
  }
  if (raw.raw_precip_mm > 0) {
    chips.push(`<span>${raw.raw_precip_mm.toFixed(1)} mm rain</span>`);
  }
  if (typeof raw.raw_wind_kmh === "number") {
    chips.push(`<span>${raw.raw_wind_kmh.toFixed(0)} km/h wind</span>`);
  }
  return chips.length ? `<div class="live-conditions">${chips.join("")}</div>` : "";
}

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
