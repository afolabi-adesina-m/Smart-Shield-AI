import * as Speech from "expo-speech";

export function speakNav(text: string, muted: boolean): void {
  if (muted || !text) return;
  try {
    Speech.stop();
    Speech.speak(text, { language: "en-CA", rate: 1 });
  } catch {
    /* Some browsers block speech until a tap. The banner still shows the turn. */
  }
}

export function stopSpeech(): void {
  try {
    Speech.stop();
  } catch {
    /* Already quiet. */
  }
}
