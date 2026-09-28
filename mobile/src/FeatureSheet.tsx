import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { FleetPanel } from "./FleetPanel";
import type { Place, PracticeLoop, RoadStep, ScoredRoute, SpeedReading, Suggestion, TestCentre } from "./types";

const WEATHER = [
  { id: "auto", label: "Auto" },
  { id: "clear", label: "Clear" },
  { id: "wet", label: "Wet" },
  { id: "blizzard", label: "Blizzard" },
  { id: "ice_storm", label: "Ice" },
] as const;

const SPEEDS = [30, 40, 50, 60, 80, 100, 120];

type SheetTab = "trip" | "practice" | "fleet" | "delivery";

type Props = {
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  delivery: ReactNode;
  origin: Place;
  destination: Place;
  onOrigin: (label: string) => void;
  onDestination: (label: string) => void;
  onFocusField: (field: "origin" | "destination") => void;
  activeField: "origin" | "destination" | null;
  suggestions: Suggestion[];
  onPick: (item: Suggestion) => void;
  onUseLocation: () => void;
  weather: string;
  onWeather: (id: string) => void;
  busy: boolean;
  onFind: () => void;
  routes: ScoredRoute[];
  selected: number;
  onSelect: (index: number) => void;
  steps: RoadStep[];
  onPreviewStep: (index: number) => void;
  onClearPreview: () => void;
  centres: TestCentre[];
  centreId: string;
  onCentre: (id: string) => void;
  level: "G2" | "G";
  onLevel: (level: "G2" | "G") => void;
  onLoop: () => void;
  disclaimer: string;
  loop: PracticeLoop | null;
  status: string;
  speedMode: "gps" | "simulate";
  demoKmh: number;
  gpsNote: string;
  onSimulate: () => void;
  onGps: () => void;
  onSpeed: (value: number) => void;
  speed: SpeedReading | null;
  recommended: number | null;
  apiBase: string;
  onClose: () => void;
};

export function FeatureSheet(props: Props) {
  return (
    <View style={styles.layer}>
      <Pressable style={styles.backdrop} testID="sheet-backdrop" onPress={props.onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{props.tab === "delivery" ? "Delivery" : "Trip tools"}</Text>
          <Pressable onPress={props.onClose} testID="sheet-close">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.tabs}>
          <Tab label="Trip" active={props.tab === "trip"} onPress={() => props.onTab("trip")} />
          <Tab label="Fleet" active={props.tab === "fleet"} onPress={() => props.onTab("fleet")} />
          <Tab label="Practice" active={props.tab === "practice"} onPress={() => props.onTab("practice")} />
          <Tab label="Delivery" active={props.tab === "delivery"} onPress={() => props.onTab("delivery")} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {props.tab === "delivery" ? (
            props.delivery
          ) : props.tab === "fleet" ? (
            <FleetPanel speedMode={props.speedMode} />
          ) : props.tab === "trip" ? (
            <>
              <Field label="From" value={props.origin.label} onChangeText={props.onOrigin} onFocus={() => props.onFocusField("origin")} />
              {props.activeField === "origin" ? <SuggestList items={props.suggestions} onPick={props.onPick} /> : null}
              <Field label="To" value={props.destination.label} onChangeText={props.onDestination} onFocus={() => props.onFocusField("destination")} />
              {props.activeField === "destination" ? <SuggestList items={props.suggestions} onPick={props.onPick} /> : null}
              <Pressable onPress={props.onUseLocation}>
                <Text style={styles.link}>Use my location as start</Text>
              </Pressable>
              <Text style={styles.kicker}>Road conditions</Text>
              <View style={styles.chips}>
                {WEATHER.map((item) => (
                  <Pressable
                    key={item.id}
                    testID={`weather-${item.id}`}
                    style={[styles.chip, props.weather === item.id && styles.chipOn]}
                    onPress={() => props.onWeather(item.id)}
                  >
                    <Text style={[styles.chipText, props.weather === item.id && styles.chipTextOn]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.primary, props.busy && styles.disabled]} disabled={props.busy} onPress={props.onFind}>
                {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Find safest route</Text>}
              </Pressable>
              {props.routes.map((route) => (
                <RouteCard
                  key={route.route_index}
                  route={route}
                  selected={route.route_index === props.selected}
                  onPress={() => props.onSelect(route.route_index)}
                />
              ))}
              {props.steps.length ? (
                <>
                  <Text style={styles.kicker}>Turn-by-turn</Text>
                  {props.steps.map((step, index) => (
                    <Pressable
                      key={`${step.name}-${index}`}
                      onPress={() => props.onPreviewStep(index)}
                      onLongPress={() => props.onPreviewStep(index)}
                      onHoverIn={() => props.onPreviewStep(index)}
                      onHoverOut={props.onClearPreview}
                      style={styles.step}
                    >
                      <Text style={styles.point}>{step.instruction}</Text>
                      <Text style={styles.note}>{step.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.kicker}>DriveTest centre</Text>
              <View style={styles.chips}>
                {props.centres.map((centre) => (
                  <Pressable
                    key={centre.id}
                    style={[styles.chip, props.centreId === centre.id && styles.chipOn]}
                    onPress={() => props.onCentre(centre.id)}
                  >
                    <Text style={[styles.chipText, props.centreId === centre.id && styles.chipTextOn]}>{centre.name}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.chips}>
                {(["G2", "G"] as const).map((item) => (
                  <Pressable key={item} style={[styles.chip, props.level === item && styles.chipOn]} onPress={() => props.onLevel(item)}>
                    <Text style={[styles.chipText, props.level === item && styles.chipTextOn]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.primary, props.busy && styles.disabled]} disabled={props.busy || !props.centreId} onPress={props.onLoop}>
                {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Build practice loop</Text>}
              </Pressable>
              {props.disclaimer ? <Text style={styles.note}>{props.disclaimer}</Text> : null}
              {props.loop?.points.map((point, index) => (
                <Text key={`${point.kind}-${index}`} style={styles.point}>{point.label}</Text>
              ))}
            </>
          )}
          <Text style={styles.status}>{props.status}</Text>
          <Text style={styles.kicker}>{props.speedMode === "gps" ? "GPS speed" : `Simulate ${props.demoKmh} km/h`}</Text>
          <Text style={styles.note}>{props.gpsNote}</Text>
          {props.speedMode === "gps" ? (
            <Pressable onPress={props.onSimulate}><Text style={styles.link}>Simulate a speed</Text></Pressable>
          ) : (
            <Pressable onPress={props.onGps}><Text style={styles.link}>Use GPS speed</Text></Pressable>
          )}
          {props.speedMode === "simulate" ? (
            <View style={styles.chips}>
              {SPEEDS.map((value) => (
                <Pressable
                  key={value}
                  testID={`sim-${value}`}
                  style={[styles.chip, props.demoKmh === value && styles.chipOn]}
                  onPress={() => props.onSpeed(value)}
                >
                  <Text style={[styles.chipText, props.demoKmh === value && styles.chipTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {props.speed?.road_name ? <Text style={styles.note}>{props.speed.road_name}{props.speed.road_mode ? ` · ${props.speed.road_mode}` : ""}{props.speed.estimated ? " · estimated" : ""}</Text> : null}
          {props.speed?.summary ? <Text style={styles.note}>{props.speed.summary}</Text> : null}
          {props.recommended != null ? <Text style={styles.note}>Route recommendation {props.recommended} km/h, folded into the safe speed.</Text> : null}
          <Text style={styles.fine}>API {props.apiBase}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; onFocus: () => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.kicker}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.label}
        placeholderTextColor="#8b97a6"
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

function SuggestList({ items, onPick }: { items: Suggestion[]; onPick: (item: Suggestion) => void }) {
  if (!items.length) return null;
  return (
    <View style={styles.suggest}>
      {items.map((item) => (
        <Pressable key={item.id || item.label} style={styles.suggestItem} onPress={() => onPick(item)}>
          <Text style={styles.suggestLabel}>{item.label}</Text>
          {item.detail ? <Text style={styles.note}>{item.detail}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function Tab(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, props.active && styles.tabOn]} onPress={props.onPress}>
      <Text style={[styles.tabText, props.active && styles.tabTextOn]}>{props.label}</Text>
    </Pressable>
  );
}

function RouteCard(props: { route: ScoredRoute; selected: boolean; onPress: () => void }) {
  const route = props.route;
  const stage = route.stage_a_fatal;
  const stageText = stage == null
    ? "Stage A fatal: not available"
    : `Stage A fatal: ${stage.flagged ? "flagged" : "not flagged"}${stage.p_fatal != null ? ` (${Math.round(stage.p_fatal * 100)}%)` : ""}`;
  return (
    <Pressable style={[styles.card, props.selected && styles.cardOn]} onPress={props.onPress}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{route.summary || `Route ${(route.route_index ?? 0) + 1}`}</Text>
        <Text style={[styles.score, { color: route.tier_color || "#1a56db" }]}>
          {route.safety_score == null ? "—" : route.safety_score}
        </Text>
      </View>
      <Text style={styles.tier}>{route.tier || "Unscored"} · {route.duration_text || ""} · {route.distance_km ?? "—"} km</Text>
      <Text style={styles.note}>
        Recommended {route.recommended_speed_kmh == null ? "—" : `${route.recommended_speed_kmh} km/h`}
        {" · "}
        Collision risk {route.collision_risk_index == null ? "—" : route.collision_risk_index}
      </Text>
      <Text style={styles.note}>{stageText}. Display only. It is not part of the safety score.</Text>
      {route.alert_preview ? <Text style={styles.note}>{route.alert_preview}</Text> : null}
      <Text style={styles.fine}>
        Alerts: {route.alert_source || "—"} · Weather: {route.e_index_source || "—"} · Vision: {route.vision_source || "—"}
      </Text>
      {route.operational_message ? <Text style={styles.note}>{route.operational_message}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    maxHeight: "78%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#16191f" },
  close: { color: "#1a56db", fontWeight: "700" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, paddingBottom: 0 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#eef2f7" },
  tabOn: { backgroundColor: "#1a56db" },
  tabText: { fontWeight: "700", color: "#526072" },
  tabTextOn: { color: "#ffffff" },
  body: { padding: 12, paddingBottom: 28, gap: 8 },
  field: { gap: 4 },
  kicker: { fontSize: 12, fontWeight: "700", color: "#526072" },
  input: {
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#16191f",
    backgroundColor: "#fff",
  },
  suggest: { borderWidth: 1, borderColor: "rgba(22,25,31,0.12)", borderRadius: 12, overflow: "hidden" },
  suggestItem: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(22,25,31,0.06)" },
  suggestLabel: { color: "#16191f", fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#eef2f7" },
  chipOn: { backgroundColor: "#1a56db" },
  chipText: { color: "#16191f", fontWeight: "600" },
  chipTextOn: { color: "#ffffff" },
  primary: {
    backgroundColor: "#1a56db",
    borderRadius: 14,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
  link: { color: "#1a56db", fontWeight: "700", paddingVertical: 4 },
  disabled: { opacity: 0.6 },
  card: {
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  cardOn: { borderColor: "#1a56db" },
  cardHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontWeight: "700", color: "#16191f" },
  score: { fontSize: 22, fontWeight: "800" },
  tier: { color: "#16191f", fontWeight: "600" },
  note: { color: "#526072", fontSize: 13, lineHeight: 18 },
  point: { color: "#16191f", fontSize: 14, paddingVertical: 2 },
  step: { paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  status: { color: "#16191f", fontSize: 13, lineHeight: 18, marginTop: 6 },
  fine: { color: "#8b97a6", fontSize: 11 },
});
