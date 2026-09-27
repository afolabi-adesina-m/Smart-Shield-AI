/** Live site by default. Override with EXPO_PUBLIC_API_BASE for a local Flask server. */
const fromEnv = (process.env.EXPO_PUBLIC_API_BASE || "").trim().replace(/\/$/, "");

export const API_BASE = fromEnv || "https://smart-shield-ai.onrender.com";

export const COLD_START_HINT =
  "The free server sleeps when nobody is using it. The first request can take about a minute. This screen will keep trying.";
