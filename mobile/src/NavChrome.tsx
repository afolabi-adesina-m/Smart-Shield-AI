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
  onDelivery: () => void;
  estimateNote: string;
  onReport: () => void;
  onCloseReport: () => void;
  onSaveReport: (kind: ReportKind) => void;
  onExit: () => void;
  onWhereTo: () => void;
  night: boolean;
};

export function NavChrome(props: Props) {
  const ink = props.night ? "#ffffff" : "#16191f";
  const tileTone = props.level === "red" ? styles.tileRed : props.level === "amber" ? styles.tileAmber : props.night ? styles.tileOk : styles.tileDay;
  const speedLabel = `speed ${props.current ?? "none"} posted ${props.posted ?? "none"} safe ${props.safe ?? "none"} ${props.level}`;
  const numDark = props.level === "amber" || (!props.night && props.level !== "red");
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {props.maneuver ? <Banner maneuver={props.maneuver} night={props.night} /> : null}
      {props.estimateNote ? (
        <View style={[styles.estimate, props.maneuver ? styles.estimateBelow : null, !props.night && styles.estimateDay]} testID="delivery-map-label">
          <Text style={[styles.estimateText, !props.night && styles.ink]}>{props.estimateNote}</Text>
        </View>
      ) : null}
      <View style={styles.side} pointerEvents="box-none">
        <View style={styles.sideStack}>
          <RoundButton label="Compass" night={props.night} onPress={props.onCompass}>
            <View style={{ transform: [{ rotate: `${-props.heading}deg` }] }}>
              <NorthNeedle south={ink} />
            </View>
          </RoundButton>
          <RoundButton label="Search" night={props.night} onPress={props.onSearch}>
            <SearchIcon color={ink} />
          </RoundButton>
          <RoundButton label={props.muted ? "Unmute voice" : "Mute voice"} night={props.night} onPress={props.onMute}>
            <SpeakerIcon muted={props.muted} color={ink} />
          </RoundButton>
          <RoundButton label="Route options" night={props.night} onPress={props.onRoutes}>
            <ForkIcon color={ink} />
          </RoundButton>
          <RoundButton label="Delivery" night={props.night} onPress={props.onDelivery}>
            <BagIcon color={ink} />
          </RoundButton>
        </View>
        <Pressable style={[styles.report, !props.night && styles.reportDay]} accessibilityLabel="Report" onPress={props.onReport}>
          <WarningIcon />
          <Text style={[styles.reportText, !props.night && styles.reportTextDay]}>Report</Text>
        </Pressable>
      </View>
      <View style={styles.speedRow} pointerEvents="none">
        <View style={styles.sign} testID="limit-sign">
          <Text style={styles.signNum}>{props.posted == null ? "—" : String(props.posted)}</Text>
        </View>
        <View style={[styles.tile, tileTone]} testID="speed-tile" accessibilityLabel={speedLabel}>
          <Text style={[styles.tileNum, numDark && styles.tileNumDark]}>
            {props.current == null ? "—" : String(props.current)}
          </Text>
          <Text style={[styles.tileUnit, numDark && styles.tileNumDark]}>km/h</Text>
        </View>
      </View>
      {props.showExit ? (
        <View style={[styles.card, !props.night && styles.cardDay]} testID="eta-card">
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, !props.night && styles.ink]}>{props.etaTitle}</Text>
            <Text style={[styles.cardSub, !props.night && styles.subDay]}>{props.etaSubtitle}</Text>
          </View>
          <Pressable style={styles.exit} testID="exit-nav" onPress={props.onExit}>
            <Text style={styles.exitText}>Exit</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.card, !props.night && styles.cardDay]} testID="where-to" onPress={props.onWhereTo}>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, !props.night && styles.ink]}>Where to?</Text>
            <Text style={[styles.cardSub, !props.night && styles.subDay]}>Search a destination</Text>
          </View>
        </Pressable>
      )}
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

function BagIcon({ color }: { color: string }) {
  return (
    <View style={styles.bag}>
      <View style={[styles.bagHandle, { borderColor: color }]} />
      <View style={[styles.bagBody, { borderColor: color }]} />
    </View>
  );
}

function Banner({ maneuver, night }: { maneuver: Maneuver; night: boolean }) {
  const ink = night ? "#ffffff" : "#142033";
  return (
    <View style={[styles.banner, !night && styles.bannerDay]} testID="nav-banner">
      <TurnGlyph kind={maneuver.kind} color={ink} />
      <View style={styles.bannerText}>
        <Text style={[styles.bannerDistance, !night && styles.bannerDistanceDay]}>{maneuver.kind === "arrive" ? "Arrive" : maneuver.distanceM < 30 ? "Now" : distancePhrase(maneuver)}</Text>
        <View style={styles.bannerStreetRow}>
          {maneuver.shield ? (
            <View style={styles.shield}>
              <Text style={styles.shieldText}>{maneuver.shield}</Text>
            </View>
          ) : null}
          <Text style={[styles.bannerStreet, { color: ink }]} numberOfLines={1}>{maneuver.street}</Text>
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

function TurnGlyph({ kind, color }: { kind: ManeuverKind; color: string }) {
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
  bannerDay: { backgroundColor: "#ffffff" },
  bannerDistanceDay: { color: "#3d6b62" },
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
  tileDay: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "rgba(22,25,31,0.12)" },
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
