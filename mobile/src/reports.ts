import AsyncStorage from "@react-native-async-storage/async-storage";

const REPORTS_KEY = "smartshield.reports.v1";
const MUTE_KEY = "smartshield.navMute.v1";

export type ReportKind = "hazard" | "police" | "crash" | "closure" | "camera";

export type RoadReport = {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  at: string;
};

export const REPORT_LABELS: { kind: ReportKind; label: string }[] = [
  { kind: "hazard", label: "Hazard" },
  { kind: "police", label: "Police" },
  { kind: "crash", label: "Crash" },
  { kind: "closure", label: "Road closure" },
  { kind: "camera", label: "Speed camera" },
];

export async function loadReports(): Promise<RoadReport[]> {
  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) as RoadReport[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveReport(report: Omit<RoadReport, "id" | "at">): Promise<RoadReport[]> {
  const next: RoadReport = {
    ...report,
    id: `${Date.now()}`,
    at: new Date().toISOString(),
  };
  const all = [next, ...(await loadReports())].slice(0, 40);
  await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(all));
  return all;
}

export async function loadMuted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MUTE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function saveMuted(muted: boolean): Promise<void> {
  await AsyncStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}
