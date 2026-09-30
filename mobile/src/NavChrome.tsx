import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LaneHint, Maneuver, ManeuverKind } from "./navCue";
import { REPORT_LABELS, type ReportKind } from "./reports";
import type { WarningLevel } from "./fleetLogic";
import { Glass } from "./glass";

export type ToolId = "trip" | "fleet" | "practice" | "delivery" | "settings";

type Props = {
  maneuver: Maneuver | null;
  thenManeuver?: Maneuver | null;
  posted: number | null;
  current: number | null;
  safe: number | null;
  level: WarningLevel;
  etaTitle: string;
  etaSubtitle: string;
  showExit: boolean;
  heading: number;
  muted: boolean;
  reportOpen: boolean;
  reportNote: string;
  onCompass: () => void;
  onMute: () => void;
  onReport: () => void;
  onGear: () => void;
  menuOpen: boolean;
  onMenu: (id: ToolId) => void;
  onLocate: () => void;
  onLayers: () => void;
  onNorth: () => void;
  mapRotated: boolean;
  onCloseReport: () => void;
  onSaveReport: (kind: ReportKind) => void;
  onExit: () => void;
  onWhereTo: () => void;
  night: boolean;
  cameraNote?: string;
  risk?: string;
  showRecenter?: boolean;
  onRecenter?: () => void;
  driving?: boolean;
  travelMode?: "drive" | "motorcycle" | "cycle" | "walk" | "transit";
  arrival?: string;
  minutesLabel?: string;
  distanceLabel?: string;
  distanceUnit?: string;
  roadName?: string;
};

// Expo Go draws its own dev button in the top-right, over the status bar.
// Start our column a full tap target plus a gap below the safe area so both can be pressed.
const EXPO_CORNER_CLEARANCE = 72;

const TOOLS: { id: ToolId; label: string }[] = [
  { id: "trip", label: "Trip" },
  { id: "fleet", label: "Fleet" },
  { id: "practice", label: "Practice" },
  { id: "delivery", label: "Delivery" },
  { id: "settings", label: "Settings" },
];

export function NavChrome(props: Props) {
  const insets = useSafeAreaInsets();
  const ink = props.night ? "#f2f2f7" : "#1c1c1e";
  const speedLabel = `speed ${props.current ?? "none"} posted ${props.posted ?? "none"} safe ${props.safe ?? "none"} ${props.level}`;
  const driving = !!props.driving;
  const vehicle = props.travelMode == null || props.travelMode === "drive" || props.travelMode === "motorcycle";
  const speedText = props.current == null ? "—" : String(Math.round(props.current));
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {props.maneuver ? (
        <View style={{ top: insets.top + 8, position: "absolute", left: 12, right: 72 }}>
          <Banner maneuver={props.maneuver} thenManeuver={props.thenManeuver} night={props.night} />
        </View>
      ) : null}
      {props.cameraNote ? (
        <View style={[styles.cameraNote, { top: insets.top + 8 }]} pointerEvents="none">
          <Text style={styles.cameraNoteText}>{props.cameraNote}</Text>
        </View>
      ) : null}
      <View style={[styles.side, { top: Math.max(insets.top, 20) + EXPO_CORNER_CLEARANCE }]} pointerEvents="box-none">
        <Glass night={props.night} style={styles.controlGroup}>
          {driving ? null : (
            <Pressable accessibilityLabel="Trip tools" testID="tool-gear" onPress={props.onGear} style={styles.iconButton}>
              <Ionicons name="settings-sharp" size={22} color="#0a84ff" />
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={props.muted ? "Unmute voice" : "Mute voice"}
            accessibilityState={{ selected: props.muted }}
            testID="mute-voice"
            onPress={props.onMute}
            style={styles.iconButton}
          >
            <SpeakerIcon muted={props.muted} color={ink} />
          </Pressable>
          <IconButton label="Locate" name="locate" color="#0a84ff" onPress={props.onLocate} />
          {props.mapRotated ? (
            <IconButton label="Compass" name="compass" color={ink} onPress={props.onNorth} />
          ) : null}
          <IconButton label="Map layers" name="layers" color={ink} onPress={props.onLayers} />
          {driving ? <IconButton label="Report" name="warning" color="#f5c542" onPress={props.onReport} /> : null}
        </Glass>
        {props.menuOpen ? (
          <Glass night={props.night} style={styles.menu}>
            <View testID="tool-menu">
              {TOOLS.map((item) => (
                <Pressable key={item.id} testID={`tool-${item.id}`} style={styles.menuRow} onPress={() => props.onMenu(item.id)}>
                  <Text style={[styles.menuText, { color: ink }]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </Glass>
        ) : null}
      </View>
      {driving ? null : (
        <Pressable
          accessibilityLabel="Report"
          onPress={props.onReport}
          style={[styles.reportFloat, { bottom: Math.max(insets.bottom, 8) + 78, right: 12 }]}
        >
          <Glass night={props.night} style={styles.report}>
            <Ionicons name="warning" size={16} color="#f5c542" />
            <Text style={[styles.reportText, { color: ink }]}>Report</Text>
          </Glass>
        </Pressable>
      )}
      {vehicle ? <View style={[styles.speedRow, { bottom: Math.max(insets.bottom, 8) + (driving ? 78 : 86) }]} pointerEvents="none">
        <View style={styles.maxSign} testID="limit-sign">
          <Text style={styles.maxWord} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>MAX</Text>
          <Text style={styles.maxNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{props.posted == null ? "—" : String(props.posted)}</Text>
        </View>
        <View style={[styles.speedTile, props.night && styles.speedTileNight]} testID="speed-tile" accessibilityLabel={speedLabel}>
          <Text style={[styles.speedNum, props.night && styles.speedNumNight, props.level === "red" && styles.speedHot, props.level === "amber" && styles.speedWarm]} numberOfLines={1}>
            {speedText}
          </Text>
          <Text style={[styles.speedUnit, props.night && styles.speedNumNight, props.level === "red" && styles.speedHot, props.level === "amber" && styles.speedWarm]}>km/h</Text>
        </View>
      </View> : null}
      {driving && props.roadName ? (
        <View style={styles.roadPill} pointerEvents="none">
          <Text style={styles.roadPillText} numberOfLines={1}>{props.roadName}</Text>
        </View>
      ) : null}
      {props.showExit && driving ? (
        <Glass night={props.night} style={[styles.etaPill, { bottom: Math.max(12, insets.bottom + 8) }]} testID="eta-card">
          <View style={styles.etaCol}>
            <Text style={[styles.etaStrong, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{props.arrival || "—"}</Text>
            <Text style={styles.etaHint} numberOfLines={1}>arrival</Text>
          </View>
          <View style={styles.etaCol}>
            <Text style={[styles.etaStrong, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{props.minutesLabel || "—"}</Text>
            <Text style={styles.etaHint} numberOfLines={1}>min</Text>
          </View>
          <View style={styles.etaCol}>
            <Text style={[styles.etaStrong, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{props.distanceLabel || "—"}</Text>
            <Text style={styles.etaHint} numberOfLines={1}>{props.distanceUnit || "km"}</Text>
          </View>
          {vehicle && props.risk ? <Text style={styles.riskChip} numberOfLines={1}>Risk {props.risk}</Text> : null}
          {!vehicle && driving ? <Text style={styles.riskChip} numberOfLines={1}>Driving only</Text> : null}
          <Pressable style={styles.exitQuiet} testID="exit-nav" onPress={props.onExit}>
            <Text style={[styles.exitQuietText, { color: ink }]} numberOfLines={1}>Exit</Text>
          </Pressable>
        </Glass>
      ) : props.showExit ? (
        <Glass night={props.night} style={[styles.card, { bottom: Math.max(12, insets.bottom + 8) }]} testID="eta-card">
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: ink }]}>{props.etaTitle}</Text>
            <Text style={styles.cardSub}>{props.etaSubtitle}</Text>
          </View>
          <Pressable style={styles.exit} testID="exit-nav" onPress={props.onExit}>
            <Text style={styles.exitText}>Exit</Text>
          </Pressable>
        </Glass>
      ) : null}
      {props.reportOpen ? (
        <View style={styles.reportLayer} pointerEvents="box-none">
          <Pressable style={styles.backdrop} onPress={props.onCloseReport} />
          <View style={[styles.reportSheet, !props.night && styles.cardDay]} testID="report-sheet">
            <Text style={[styles.reportTitle, !props.night && styles.ink]}>Report</Text>
            <Text style={[styles.reportHint, !props.night && styles.subDay]}>Saved on this phone. The server does not take reports.</Text>
            {REPORT_LABELS.map((item) => (
              <Pressable key={item.kind} style={styles.reportRow} testID={`report-${item.kind}`} onPress={() => props.onSaveReport(item.kind)}>
                <Text style={styles.reportRowText}>{item.label}</Text>
              </Pressable>
            ))}
            {props.reportNote ? <Text style={styles.reportSaved}>{props.reportNote}</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function IconButton(props: { name: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={props.label} onPress={props.onPress} style={styles.iconButton}>
      <Ionicons name={props.name} size={22} color={props.color} />
    </Pressable>
  );
}

function BagIcon({ color }: { color: string }) {
  return (
    <View style={styles.bag}>
      <View style={[styles.bagHandle, { borderColor: color }]} />
      <View style={[styles.bagBody, { borderColor: color }]} />
    </View>
  );
}

function Banner({ maneuver, thenManeuver, night }: { maneuver: Maneuver; thenManeuver?: Maneuver | null; night: boolean }) {
  const ink = night ? "#ffffff" : "#1c1c1e";
  return (
    <Glass night={night} style={styles.banner} testID="nav-banner">
      <TurnGlyph kind={maneuver.kind} color={ink} />
      <View style={styles.bannerText}>
        <Text style={[styles.bannerDistance, { color: ink }]}>{maneuver.kind === "arrive" ? "Arrive" : maneuver.distanceM < 30 ? "Now" : distancePhrase(maneuver)}</Text>
        <View style={styles.bannerStreetRow}>
          {maneuver.shield ? (
            <View style={styles.shield}>
              <Text style={styles.shieldText}>{maneuver.shield}</Text>
            </View>
          ) : null}
          <Text style={[styles.bannerStreet, { color: ink }]} numberOfLines={1}>{maneuver.street}</Text>
        </View>
        <LaneRow lanes={maneuver.lanes} />
        {thenManeuver ? (
          <View style={styles.thenRow}>
            <Text style={[styles.thenLabel, { color: ink }]}>Then</Text>
            <Text style={[styles.thenArrow, { color: ink }]}>{thenArrow(thenManeuver.kind)}</Text>
            <Text style={[styles.thenText, { color: ink }]} numberOfLines={1}>{thenManeuver.street}</Text>
          </View>
        ) : null}
      </View>
    </Glass>
  );
}

function LaneRow({ lanes }: { lanes?: LaneHint[] }) {
  const shown = (lanes || []).filter((lane) => (lane.indications || []).length);
  if (!shown.length) return null;
  return (
    <View style={styles.lanes}>
      {shown.map((lane, index) => {
        const hint = (lane.indications || [])[0] || "straight";
        const arrow = hint.includes("left") ? "←" : hint.includes("right") ? "→" : hint.includes("uturn") ? "↩" : "↑";
        return (
          <Text key={`${hint}-${index}`} style={[styles.lane, lane.valid ? styles.laneOn : styles.laneOff]}>{arrow}</Text>
        );
      })}
    </View>
  );
}

function thenArrow(kind: ManeuverKind): string {
  if (kind === "left" || kind === "slight-left") return "←";
  if (kind === "right" || kind === "slight-right" || kind === "exit") return "→";
  if (kind === "uturn") return "↩";
  if (kind === "roundabout") return "↻";
  if (kind === "merge") return "↗";
  if (kind === "arrive") return "●";
  return "↑";
}

function distancePhrase(maneuver: Maneuver): string {
  const meters = maneuver.distanceM;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function TurnGlyph({ kind, color }: { kind: ManeuverKind; color: string }) {
  const rotate = {
    straight: "0deg",
    left: "-90deg",
    right: "90deg",
    "slight-left": "-40deg",
    "slight-right": "40deg",
    uturn: "180deg",
    arrive: "0deg",
    merge: "-20deg",
    roundabout: "40deg",
    exit: "28deg",
  }[kind];
  if (kind === "arrive") {
    return <View style={[styles.arriveDot, { backgroundColor: color }]} />;
  }
  return (
    <View style={[styles.turnWrap, { transform: [{ rotate }] }]}>
      <View style={[styles.turnStem, { backgroundColor: color }]} />
      <View style={[styles.turnHead, { borderBottomColor: color }]} />
    </View>
  );
}

function RoundButton(props: { label: string; night: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable style={[styles.round, !props.night && styles.roundDay]} accessibilityLabel={props.label} onPress={props.onPress}>
      {props.children}
    </Pressable>
  );
}

function NorthNeedle({ south }: { south: string }) {
  return (
    <View style={styles.needle}>
      <View style={styles.needleNorth} />
      <View style={[styles.needleSouth, { borderTopColor: south }]} />
    </View>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <View style={styles.search}>
      <View style={[styles.searchRing, { borderColor: color }]} />
      <View style={[styles.searchHandle, { backgroundColor: color }]} />
    </View>
  );
}

function SpeakerIcon({ muted, color }: { muted: boolean; color: string }) {
  return (
    <View style={styles.speaker}>
      <View style={[styles.speakerBody, { backgroundColor: color }]} />
      <View style={[styles.speakerCone, { borderLeftColor: color }]} />
      {muted ? <View style={[styles.speakerSlash, { backgroundColor: color }]} /> : <View style={[styles.speakerWave, { borderColor: color }]} />}
    </View>
  );
}

function ForkIcon({ color }: { color: string }) {
  return (
    <View style={styles.fork}>
      <View style={[styles.forkLeft, { backgroundColor: color }]} />
      <View style={[styles.forkRight, { backgroundColor: color }]} />
    </View>
  );
}

function WarningIcon() {
  return <View style={styles.warnTri} />;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  cameraNote: {
    position: "absolute",
    left: 12,
    right: 88,
    bottom: 112,
    backgroundColor: "rgba(14,22,32,0.82)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cameraNoteText: { color: "#d5dde6", fontSize: 11, lineHeight: 15 },
  estimate: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 76,
    backgroundColor: "#1b1d22",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  estimateBelow: { top: 96 },
  estimateDay: { backgroundColor: "#ffffff" },
  estimateText: { color: "#ffffff", fontWeight: "700", fontSize: 13, lineHeight: 18 },
  bag: { width: 18, height: 18, alignItems: "center" },
  bagHandle: { width: 8, height: 5, borderWidth: 2, borderBottomWidth: 0, borderRadius: 4, marginBottom: 1 },
  bagBody: { width: 14, height: 11, borderWidth: 2, borderRadius: 2 },
  controlGroup: {
    borderRadius: 16,
    overflow: "hidden",
    width: 44,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    width: 220,
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 8,
  },
  menuRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: { fontSize: 17, fontWeight: "600" },
  banner: {
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bannerNav: { backgroundColor: "rgba(16,20,26,0.9)" },
  bannerDay: { backgroundColor: "#ffffff" },
  bannerDistanceDay: { color: "#3d6b62" },
  bannerText: { flex: 1, gap: 2 },
  bannerDistance: { color: "#ffffff", fontSize: 26, fontWeight: "700" },
  thenRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  thenLabel: { color: "#ffffff", fontSize: 14, fontWeight: "600", opacity: 0.9 },
  thenArrow: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  thenText: { color: "#ffffff", fontSize: 14, fontWeight: "600", flex: 1 },
  recenterMark: { fontSize: 18, fontWeight: "700" },
  riskChip: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    marginTop: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  riskChipDay: { backgroundColor: "#e7f0ea", color: "#14685c" },
  bannerStreetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bannerStreet: { color: "#ffffff", fontSize: 22, fontWeight: "700", flex: 1 },
  shield: {
    minWidth: 28,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#f4f7fb",
    alignItems: "center",
  },
  shieldText: { color: "#142033", fontWeight: "800", fontSize: 13 },
  lanes: { flexDirection: "row", gap: 4, marginTop: 6 },
  lane: {
    minWidth: 22,
    height: 26,
    borderRadius: 4,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 26,
    fontWeight: "800",
    fontSize: 14,
  },
  laneOn: { backgroundColor: "#ffffff", color: "#142033" },
  laneOff: { backgroundColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.45)" },
  turnWrap: { width: 48, height: 48, alignItems: "center" },
  turnStem: { width: 6, height: 22, backgroundColor: "#fff", borderRadius: 2, marginTop: 16 },
  turnHead: {
    position: "absolute",
    top: 2,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 16,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#fff",
  },
  arriveDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#fff",
    marginHorizontal: 9,
  },
  side: {
    position: "absolute",
    right: 12,
    alignItems: "flex-end",
    gap: 10,
  },
  sideStack: { gap: 12 },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(28,31,36,0.94)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roundDay: { backgroundColor: "#ffffff", borderColor: "rgba(22,25,31,0.12)" },
  needle: { width: 16, height: 22, alignItems: "center" },
  needleNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#e23b2f",
  },
  needleSouth: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#f4f7fb",
  },
  search: { width: 22, height: 22 },
  searchRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
  },
  searchHandle: {
    position: "absolute",
    width: 8,
    height: 2,
    backgroundColor: "#fff",
    right: 0,
    bottom: 3,
    transform: [{ rotate: "45deg" }],
  },
  speaker: { width: 22, height: 18, justifyContent: "center", position: "relative" },
  speakerBody: { width: 6, height: 8, backgroundColor: "#fff", marginLeft: 2 },
  speakerCone: {
    position: "absolute",
    left: 6,
    top: 2,
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 8,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#fff",
  },
  speakerWave: {
    position: "absolute",
    right: 0,
    top: 4,
    width: 6,
    height: 10,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#fff",
    borderRadius: 6,
  },
  speakerSlash: {
    position: "absolute",
    width: 18,
    height: 2,
    backgroundColor: "#fff",
    top: 8,
    transform: [{ rotate: "-40deg" }],
  },
  fork: { width: 20, height: 20 },
  forkLeft: {
    position: "absolute",
    width: 12,
    height: 3,
    backgroundColor: "#fff",
    top: 6,
    left: 2,
    transform: [{ rotate: "-35deg" }],
  },
  forkRight: {
    position: "absolute",
    width: 12,
    height: 3,
    backgroundColor: "#fff",
    top: 11,
    left: 4,
    transform: [{ rotate: "35deg" }],
  },
  reportFloat: { position: "absolute" },
  report: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  warnTri: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#f5c542",
  },
  reportText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  reportDay: { backgroundColor: "#ffffff", borderColor: "rgba(22,25,31,0.12)" },
  reportTextDay: { color: "#16191f" },
  speedRow: {
    position: "absolute",
    left: 12,
    bottom: 112,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  maxSign: {
    width: 42,
    height: 46,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  maxWord: { color: "#111", fontSize: 8, fontWeight: "800", letterSpacing: 0.3, width: "100%", textAlign: "center" },
  maxNum: { color: "#111", fontSize: 16, fontWeight: "800", lineHeight: 18, width: "100%", textAlign: "center" },
  speedTile: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  speedTileNight: { backgroundColor: "#1c2128", borderColor: "rgba(255,255,255,0.12)" },
  speedNum: { color: "#16191f", fontSize: 16, fontWeight: "800", lineHeight: 18 },
  speedUnit: { color: "#636366", fontSize: 9, fontWeight: "700" },
  speedNumNight: { color: "#f4f7fb" },
  speedHot: { color: "#d93025" },
  speedWarm: { color: "#c47b00" },
  roadPill: {
    position: "absolute",
    left: 72,
    right: 72,
    bottom: 78,
    alignItems: "center",
  },
  roadPillText: {
    backgroundColor: "rgba(16,20,26,0.78)",
    color: "#fff",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: "700",
    maxWidth: "100%",
  },
  overSpeed: {
    minWidth: 48,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  overNum: { color: "#fff", fontSize: 16, fontWeight: "800" },
  overUnit: { color: "#fff", fontSize: 10, fontWeight: "700" },
  speedHidden: { width: 1, height: 1, opacity: 0 },
  etaPill: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 64,
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  etaCol: { flex: 1, minWidth: 0, alignItems: "flex-start", justifyContent: "center" },
  etaStrong: { color: "#fff", fontSize: 20, fontWeight: "800", lineHeight: 24, width: "100%" },
  etaHint: { color: "#c5ced8", fontSize: 12, fontWeight: "600", lineHeight: 16, marginTop: 1 },
  exitQuiet: {
    flexGrow: 0,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  exitQuietText: { color: "#e8eef4", fontSize: 14, fontWeight: "700" },
  sign: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 4,
    borderColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  signNum: { color: "#111", fontSize: 28, fontWeight: "800" },
  tile: {
    minWidth: 86,
    height: 72,
    borderRadius: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tileOk: { backgroundColor: "#1c1f24" },
  tileDay: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "rgba(22,25,31,0.12)" },
  tileAmber: { backgroundColor: "#f0a202" },
  tileRed: { backgroundColor: "#d93025" },
  tileNum: { color: "#fff", fontSize: 32, fontWeight: "800", lineHeight: 34 },
  tileNumDark: { color: "#1a1200" },
  tileUnit: { color: "#d5dbe3", fontSize: 11, fontWeight: "700" },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 72,
    borderRadius: 16,
    overflow: "hidden",
    paddingLeft: 18,
    paddingRight: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardText: { flex: 1 },
  cardTitle: { color: "#fff", fontSize: 28, fontWeight: "700" },
  cardSub: { color: "#c5ced8", fontSize: 14, marginTop: 2 },
  cardDay: { backgroundColor: "#ffffff" },
  ink: { color: "#16191f" },
  subDay: { color: "#526072" },
  exit: {
    backgroundColor: "#e23b2f",
    borderRadius: 28,
    minWidth: 84,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  exitText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  reportLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  reportSheet: {
    backgroundColor: "#1b1d22",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    gap: 8,
  },
  reportTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  reportHint: { color: "#c5ced8", fontSize: 13, marginBottom: 4 },
  reportRow: {
    backgroundColor: "#2a2e36",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  reportRowText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  reportSaved: { color: "#9ee0c8", fontWeight: "700", marginTop: 4 },
});
