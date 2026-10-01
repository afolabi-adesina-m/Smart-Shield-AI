import * as Speech from "expo-speech";

export type VoiceGender = "female" | "male";

type ListedVoice = {
  identifier: string;
  name: string;
  quality?: string;
  language?: string;
  lang?: string;
};

const FEMALE = ["samantha", "allison", "ava", "susan", "zoe", "nicky", "serena", "kate", "martha", "moira", "karen", "tessa", "fiona", "victoria", "stephanie", "veena", "raveena", "sangeeta", "kathy", "flo", "sandy", "shelley"];
const MALE = ["alex", "daniel", "evan", "nathan", "oliver", "aaron", "arthur", "gordon", "tom", "rishi", "lee", "fred", "reed"];
const NOVELTY = ["zarvox", "trinoids", "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "hysterical", "jester", "organ", "superstar", "whisper", "wobble", "good news", "pipe organ", "junior", "ralph", "grandma", "grandpa", "eddy"];

let gender: VoiceGender = "female";
let voiceId: string | undefined;

function voiceName(voice: ListedVoice): string {
  return String(voice.name || voice.identifier || "");
}

function voiceLang(voice: ListedVoice): string {
  return String(voice.language || voice.lang || "").toLowerCase();
}

function qualityRank(voice: ListedVoice): number {
  const quality = String(voice.quality || "").toLowerCase();
  const name = voiceName(voice).toLowerCase();
  if (quality === "premium" || name.includes("premium")) return 2;
  if (quality === "enhanced" || name.includes("enhanced")) return 1;
  return 0;
}

function novelty(voice: ListedVoice): boolean {
  const name = voiceName(voice).toLowerCase();
  return NOVELTY.some((item) => name.includes(item));
}

function named(voice: ListedVoice, names: string[]): boolean {
  const tokens = voiceName(voice).toLowerCase().split(/[^a-z]+/);
  return names.some((item) => tokens.includes(item));
}

function scoreVoice(voice: ListedVoice): number {
  const lang = voiceLang(voice);
  let score = qualityRank(voice) * 100;
  if (lang.startsWith("en-ca")) score += 40;
  else if (lang.startsWith("en-us")) score += 30;
  else if (lang.startsWith("en-gb")) score += 24;
  else if (lang.startsWith("en-au")) score += 18;
  else if (lang.startsWith("en")) score += 8;
  return score;
}

/** Prefer an enhanced or premium English voice of this gender, then any installed voice of that gender. */
export function chooseVoice(voices: ListedVoice[], next: VoiceGender): ListedVoice | null {
  const want = next === "male" ? MALE : FEMALE;
  const english = (voices || []).filter((voice) => voiceLang(voice).startsWith("en") && !novelty(voice));
  const pool = english.filter((voice) => named(voice, want));
  if (!pool.length) return null;
  pool.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return pool[0];
}

export async function applyVoiceGender(next: VoiceGender): Promise<void> {
  gender = next === "male" ? "male" : "female";
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    voiceId = chooseVoice(voices, gender)?.identifier;
  } catch {
    voiceId = undefined;
  }
}

export function speakNav(text: string, muted: boolean): void {
  if (muted || !text) return;
  try {
    Speech.stop();
    const options: { language: string; rate: number; pitch: number; voice?: string } = {
      language: "en-CA",
      rate: 0.95,
      pitch: 1,
    };
    if (voiceId) options.voice = voiceId;
    Speech.speak(text, options);
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
