/**
 * Live Render site by default, so a phone does not need the laptop's Flask process.
 * Override with EXPO_PUBLIC_API_BASE or EXPO_PUBLIC_API_URL for a computer on the same Wi-Fi.
 */
const fromEnv = (process.env.EXPO_PUBLIC_API_BASE || process.env.EXPO_PUBLIC_API_URL || "")
  .trim()
  .replace(/\/$/, "");

export const API_BASE = fromEnv || "https://smart-shield-ai.onrender.com";

export const COLD_START_HINT =
  "The free server sleeps when nobody is using it. The first request can take about a minute. This screen will keep trying.";
