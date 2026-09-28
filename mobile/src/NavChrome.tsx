import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Maneuver, ManeuverKind } from "./navCue";
import { REPORT_LABELS, type ReportKind } from "./reports";
import type { WarningLevel } from "./fleetLogic";

type Props = {
  maneuver: Maneuver | null;
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
  onSearch: () => void;
  onMute: () => void;
  onRoutes: () => void;
  onReport: () => void;
  onCloseReport: () => void;
  onSaveReport: (kind: ReportKind) => void;
  onExit: () => void;
  onWhereTo: () => void;
};

export function NavChrome(props: Props) {
  const tileTone = props.level === "red" ? styles.tileRed : props.level === "amber" ? styles.tileAmber : styles.tileOk;
  const speedLabel = `speed ${props.current ?? "none"} posted ${props.posted ?? "none"} safe ${props.safe ?? "none"} ${props.level}`;
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {props.maneuver ? <Banner maneuver={props.maneuver} /> : null}
      <View style={styles.side} pointerEvents="box-none">
        <View style={styles.sideStack}>
          <RoundButton label="Compass" onPress={props.onCompass}>
            <View style={{ transform: [{ rotate: `${-props.heading}deg` }] }}>
              <NorthNeedle />
            </View>
          </RoundButton>
          <RoundButton label="Search" onPress={props.onSearch}>
            <SearchIcon />
          </RoundButton>
          <RoundButton label={props.muted ? "Unmute voice" : "Mute voice"} onPress={props.onMute}>
            <SpeakerIcon muted={props.muted} />
          </RoundButton>
          <RoundButton label="Route options" onPress={props.onRoutes}>
            <ForkIcon />
          </RoundButton>
        </View>
        <Pressable style={styles.report} accessibilityLabel="Report" onPress={props.onReport}>
          <WarningIcon />
          <Text style={styles.reportText}>Report</Text>
        </Pressable>
      </View>
      <View style={styles.speedRow} pointerEvents="none">
        <View style={styles.sign} testID="limit-sign">
          <Text style={styles.signNum}>{props.posted == null ? "—" : String(props.posted)}</Text>
        </View>
        <View style={[styles.tile, tileTone]} testID="speed-tile" accessibilityLabel={speedLabel}>
          <Text style={[styles.tileNum, props.level === "amber" && styles.tileNumDark]}>
            {props.current == null ? "—" : String(props.current)}
          </Text>
          <Text style={[styles.tileUnit, props.level === "amber" && styles.tileNumDark]}>km/h</Text>
        </View>
      </View>
      {props.showExit ? (
        <View style={styles.card} testID="eta-card">
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{props.etaTitle}</Text>
            <Text style={styles.cardSub}>{props.etaSubtitle}</Text>
          </View>
          <Pressable style={styles.exit} testID="exit-nav" onPress={props.onExit}>
            <Text style={styles.exitText}>Exit</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.card} testID="where-to" onPress={props.onWhereTo}>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Where to?</Text>
            <Text style={styles.cardSub}>Search a destination</Text>
          </View>
        </Pressable>
      )}
      {props.reportOpen ? (
        <View style={styles.reportLayer} pointerEvents="box-none">
          <Pressable style={styles.backdrop} onPress={props.onCloseReport} />
          <View style={styles.reportSheet} testID="report-sheet">
            <Text style={styles.reportTitle}>Report</Text>
            <Text style={styles.reportHint}>Saved on this phone. The server does not take reports.</Text>
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

function Banner({ maneuver }: { maneuver: Maneuver }) {
  return (
    <View style={styles.banner} testID="nav-banner">
      <TurnGlyph kind={maneuver.kind} />
      <View style={styles.bannerText}>
        <Text style={styles.bannerDistance}>{maneuver.kind === "arrive" ? "Arrive" : maneuver.distanceM < 30 ? "Now" : distancePhrase(maneuver)}</Text>
        <View style={styles.bannerStreetRow}>
          {maneuver.shield ? (
            <View style={styles.shield}>
              <Text style={styles.shieldText}>{maneuver.shield}</Text>
            </View>
          ) : null}
          <Text style={styles.bannerStreet} numberOfLines={1}>{maneuver.street}</Text>
        </View>
      </View>
    </View>
  );
}

function distancePhrase(maneuver: Maneuver): string {
  const meters = maneuver.distanceM;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function TurnGlyph({ kind }: { kind: ManeuverKind }) {
  const rotate = {
    straight: "0deg",
    left: "-90deg",
    right: "90deg",
    "slight-left": "-40deg",
    "slight-right": "40deg",
    uturn: "180deg",
    arrive: "0deg",
  }[kind];
  if (kind === "arrive") {
    return <View style={styles.arriveDot} />;
  }
  return (
    <View style={[styles.turnWrap, { transform: [{ rotate }] }]}>
      <View style={styles.turnStem} />
      <View style={styles.turnHead} />
    </View>
  );
}

function RoundButton(props: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable style={styles.round} accessibilityLabel={props.label} onPress={props.onPress}>
      {props.children}
    </Pressable>
  );
}

function NorthNeedle() {
  return (
    <View style={styles.needle}>
      <View style={styles.needleNorth} />
      <View style={styles.needleSouth} />
    </View>
  );
}

function SearchIcon() {
  return (
    <View style={styles.search}>
      <View style={styles.searchRing} />
      <View style={styles.searchHandle} />
    </View>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <View style={styles.speaker}>
      <View style={styles.speakerBody} />
      <View style={styles.speakerCone} />
      {muted ? <View style={styles.speakerSlash} /> : <View style={styles.speakerWave} />}
    </View>
  );
}

function ForkIcon() {
  return (
    <View style={styles.fork}>
      <View style={styles.forkLeft} />
      <View style={styles.forkRight} />
    </View>
  );
}

function WarningIcon() {
  return <View style={styles.warnTri} />;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  banner: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    backgroundColor: "#14685c",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerDistance: { color: "#d7efe9", fontSize: 14, fontWeight: "600" },
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
  turnWrap: { width: 36, height: 36, alignItems: "center" },
  turnStem: { width: 5, height: 16, backgroundColor: "#fff", borderRadius: 2, marginTop: 12 },
  turnHead: {
    position: "absolute",
    top: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 12,
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
    top: 108,
    right: 12,
    bottom: 118,
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sideStack: { gap: 12 },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(28,31,36,0.94)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
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
  speaker: { width: 22, height: 18, justifyContent: "center" },
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
  report: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(28,31,36,0.94)",
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
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
  speedRow: {
    position: "absolute",
    left: 12,
    bottom: 112,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sign: {
    width: 62,
    height: 62,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 4,
    borderColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  signNum: { color: "#111", fontSize: 26, fontWeight: "800" },
  tile: {
    minWidth: 74,
    height: 62,
    borderRadius: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tileOk: { backgroundColor: "#1c1f24" },
  tileAmber: { backgroundColor: "#f0a202" },
  tileRed: { backgroundColor: "#d93025" },
  tileNum: { color: "#fff", fontSize: 26, fontWeight: "800", lineHeight: 28 },
  tileNumDark: { color: "#1a1200" },
  tileUnit: { color: "#d5dbe3", fontSize: 11, fontWeight: "700" },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 88,
    backgroundColor: "#1b1d22",
    borderRadius: 22,
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
