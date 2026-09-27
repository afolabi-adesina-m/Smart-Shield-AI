import { Platform, Vibration } from "react-native";
import * as Haptics from "expo-haptics";

let lastBeep = 0;

function beep(): void {
  const now = Date.now();
  if (now - lastBeep < 2500) return;
  lastBeep = now;
  const AudioCtx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
  osc.onended = () => {
    ctx.close().catch(() => undefined);
  };
}

/** Once each time the driver goes over the posted limit. */
export function alertOverLimit(): void {
  if (Platform.OS === "web") {
    beep();
    return;
  }
  const now = Date.now();
  if (now - lastBeep < 2500) return;
  lastBeep = now;
  Vibration.vibrate(180);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
