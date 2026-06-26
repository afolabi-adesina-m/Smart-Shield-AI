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
