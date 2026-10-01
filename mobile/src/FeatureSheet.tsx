import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass } from "./glass";
import { FleetPanel } from "./FleetPanel";
import { TripMetrics } from "./TripMetrics";
import type { VoiceGender } from "./voice";
import type { ModeSummary, Place, PracticeLoop, RoadStep, ScoredRoute, SpeedReading, Suggestion, TestCentre, TransitItinerary, TravelMode } from "./types";
import { legTitle, walkCaption, walkNotes } from "./navCue";

const TRAVEL: { id: TravelMode; label: string; icon: "car" | "motorbike" | "bicycle" | "walk" | "bus" }[] = [
  { id: "drive", label: "Drive", icon: "car" },
  { id: "motorcycle", label: "Motorcycle", icon: "motorbike" },
  { id: "cycle", label: "Cycle", icon: "bicycle" },
  { id: "walk", label: "Walk", icon: "walk" },
  { id: "transit", label: "Transit", icon: "bus" },
];

const WEATHER = [
  { id: "auto", label: "Auto" },
  { id: "clear", label: "Clear" },
  { id: "wet", label: "Wet" },
  { id: "blizzard", label: "Blizzard" },
  { id: "ice_storm", label: "Ice" },
] as const;

const SPEEDS = [30, 40, 50, 60, 80, 100, 120];

type SheetTab = "trip" | "practice" | "fleet" | "delivery" | "settings";

type Props = {
  tab: SheetTab;
  night: boolean;
  topInset: number;
  muted: boolean;
  onMute: () => void;
  voiceGender: VoiceGender;
  onVoiceGender: (gender: VoiceGender) => void;
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
  cameraAlerts: boolean;
  onCameraAlerts: (enabled: boolean) => void;
  cameraNote: string;
  routeAlertCount?: number;
  onStart?: () => void;
};

const PANEL_TITLE: Record<SheetTab, string> = {
  trip: "Trip",
  fleet: "Fleet",
  practice: "Practice",
  delivery: "Delivery",
  settings: "Settings",
};

export function FeatureSheet(props: Props) {
  const [developer, setDeveloper] = useState(false);
  const night = props.night;
  const ink = night ? styles.inkNight : null;
  const card = [styles.sheet, night && styles.sheetNight, { marginTop: props.topInset }];
  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Pressable style={styles.backdrop} testID="sheet-backdrop" onPress={() => { Keyboard.dismiss(); props.onClose(); }} />
      <View style={card}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, ink]}>{PANEL_TITLE[props.tab]}</Text>
          <Pressable onPress={() => { Keyboard.dismiss(); props.onClose(); }} testID="sheet-close">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.body}
        >
          {props.tab === "delivery" ? (
            props.delivery
          ) : props.tab === "fleet" ? (
            <FleetPanel speedMode={props.speedMode} />
          ) : props.tab === "settings" ? (
            <>
              <Pressable onPress={props.onMute}>
                <Text style={styles.link}>{props.muted ? "Unmute voice" : "Mute voice"}</Text>
              </Pressable>
              <Text style={[styles.kicker, ink]}>Voice</Text>
              <View style={styles.chips}>
                {(["female", "male"] as const).map((id) => (
                  <Pressable
                    key={id}
                    testID={`voice-${id}`}
                    accessibilityRole="button"
                    accessibilityLabel={id === "female" ? "Female voice" : "Male voice"}
                    accessibilityState={{ selected: props.voiceGender === id }}
                    style={[styles.chip, props.voiceGender === id && styles.chipOn]}
                    onPress={() => props.onVoiceGender(id)}
                  >
                    <Text style={[styles.chipText, props.voiceGender === id && styles.chipTextOn]}>
                      {id === "female" ? "Female" : "Male"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <CameraToggle {...props} />
              <Pressable testID="developer-toggle" onPress={() => setDeveloper((value) => !value)}>
                <Text style={[styles.kicker, ink]}>{developer ? "Developer ▾" : "Developer ▸"}</Text>
              </Pressable>
              {developer ? <DeveloperBlock {...props} /> : null}
            </>
          ) : props.tab === "trip" ? (
            <>
              <Pressable onPress={props.onUseLocation}>
                <Text style={styles.link}>Use my location as start</Text>
              </Pressable>
              <Text style={[styles.kicker, ink]}>Road conditions</Text>
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
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Camera alerts"
                accessibilityState={{ checked: props.cameraAlerts }}
                onPress={() => props.onCameraAlerts(!props.cameraAlerts)}
                style={styles.cameraRow}
              >
                <View style={[styles.cameraBox, props.cameraAlerts && styles.cameraBoxOn]} />
                <Text style={styles.cameraLabel}>Camera alerts</Text>
              </Pressable>
              <Text style={styles.cameraFine}>{props.cameraNote}</Text>
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
        </ScrollView>
      </View>
    </View>
  );
}

function CameraToggle(props: Props) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Camera alerts"
      accessibilityState={{ checked: props.cameraAlerts }}
      onPress={() => props.onCameraAlerts(!props.cameraAlerts)}
      style={styles.cameraRow}
    >
      <View style={[styles.cameraBox, props.cameraAlerts && styles.cameraBoxOn]} />
      <Text style={styles.cameraLabel}>Camera alerts</Text>
    </Pressable>
  );
}

function DeveloperBlock(props: Props) {
  return (
    <View style={styles.dev}>
      <Text style={styles.note}>{props.status}</Text>
      <Text style={styles.note}>{props.gpsNote}</Text>
      <Text style={styles.kicker}>{props.speedMode === "gps" ? "GPS speed" : `Simulate ${props.demoKmh} km/h`}</Text>
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
      {props.speed?.summary ? <Text style={styles.note}>{props.speed.summary}</Text> : null}
      {props.recommended != null ? <Text style={styles.note}>Route recommendation {props.recommended} km/h, folded into the safe speed.</Text> : null}
      <Text style={styles.fine}>API {props.apiBase}</Text>
    </View>
  );
}

export function SearchCard(props: {
  night: boolean;
  origin: Place;
  destination: Place;
  onOrigin: (label: string) => void;
  onDestination: (label: string) => void;
  onFocusField: (field: "origin" | "destination") => void;
  activeField: "origin" | "destination" | null;
  suggestions: Suggestion[];
  onPick: (item: Suggestion) => void;
  onUseLocation: () => void;
  busy: boolean;
  onFind: () => void;
  routes: ScoredRoute[];
  selected: number;
  onSelect: (index: number) => void;
  onStart?: () => void;
  travelMode: TravelMode;
  onTravelMode: (mode: TravelMode) => void;
  summaries: Record<string, ModeSummary>;
  itineraries: TransitItinerary[];
  travelNote: string;
  plan?: { arrival: string; minutes: string; distance: string; unit: string } | null;
}) {
  const insets = useSafeAreaInsets();
  const windowH = useWindowDimensions().height;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const toRef = useRef<TextInput>(null);
  const [open, setOpen] = useState(props.routes.length > 0);
  useEffect(() => {
    if (props.routes.length) setOpen(true);
  }, [props.routes.length]);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height || 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const ink = props.night ? "#f2f2f7" : "#1c1c1e";
  const hint = props.night ? "#aeaeb2" : "#636366";
  const restingBottom = keyboardHeight > 0 ? keyboardHeight + 8 : Math.max(12, insets.bottom + 8);
  const scrollMax = keyboardHeight > 0
    ? Math.max(120, windowH - keyboardHeight - insets.top - 210)
    : 320;
  function runSearch() {
    Keyboard.dismiss();
    props.onFind();
  }
  function startRoute() {
    Keyboard.dismiss();
    props.onStart?.();
  }
  function pickSuggestion(item: Suggestion) {
    Keyboard.dismiss();
    props.onPick(item);
  }
  return (
    <Glass night={props.night} style={[styles.searchCard, { bottom: restingBottom }]}>
      <View style={styles.grabber} />
      <Pressable testID="where-to" style={styles.searchField} onPress={() => setOpen(true)}>
        <Ionicons name="search" size={18} color={hint} />
        <Text style={[styles.searchPlaceholder, { color: hint }]} numberOfLines={1}>Where to?</Text>
      </Pressable>
      <ModeChips mode={props.travelMode} summaries={props.summaries} night={props.night} onSelect={props.onTravelMode} />
      {props.plan ? (
        <TripMetrics
          arrival={props.plan.arrival}
          minutes={props.plan.minutes}
          distance={props.plan.distance}
          unit={props.plan.unit}
          color={ink}
        />
      ) : null}
      {open ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={[styles.searchScroll, { maxHeight: scrollMax }]}
          contentContainerStyle={styles.searchBody}
        >
          <Field
            label="From"
            testID="field-from"
            value={props.origin.label}
            onChangeText={props.onOrigin}
            onFocus={() => props.onFocusField("origin")}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => toRef.current?.focus()}
          />
          {props.activeField === "origin" ? <SuggestList items={props.suggestions} onPick={pickSuggestion} /> : null}
          <Field
            label="To"
            testID="field-to"
            inputRef={toRef}
            value={props.destination.label}
            onChangeText={props.onDestination}
            onFocus={() => props.onFocusField("destination")}
            returnKeyType="search"
            blurOnSubmit
            onSubmitEditing={runSearch}
          />
          {props.activeField === "destination" ? <SuggestList items={props.suggestions} onPick={pickSuggestion} /> : null}
          <Pressable onPress={props.onUseLocation}>
            <Text style={styles.link}>Use my location as start</Text>
          </Pressable>
          <Pressable style={[styles.primary, props.busy && styles.disabled]} disabled={props.busy} onPress={runSearch}>
            {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{props.travelMode === "drive" || props.travelMode === "motorcycle" ? "Find safest route" : "Find route"}</Text>}
          </Pressable>
          {props.travelNote ? <Text style={styles.note}>{props.travelNote}</Text> : null}
          {props.itineraries.map((item, index) => (
            <ItineraryCard key={`${item.start || "trip"}-${index}`} item={item} onStart={index === 0 ? startRoute : undefined} />
          ))}
          {props.itineraries.length ? null : props.routes.map((route) => (
            <RouteCard
              key={route.route_index}
              route={route}
              selected={route.route_index === props.selected}
              onPress={() => props.onSelect(route.route_index)}
              onStart={route.route_index === props.selected ? startRoute : undefined}
            />
          ))}
          <Pressable onPress={() => setOpen(false)}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </Glass>
  );
}

function ModeChips(props: {
  mode: TravelMode;
  summaries: Record<string, ModeSummary>;
  night: boolean;
  onSelect: (mode: TravelMode) => void;
}) {
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.modeRow}
    >
      {TRAVEL.map((item) => {
        const on = item.id === props.mode;
        const summary = props.summaries[item.id];
        const line = summaryLine(summary);
        const spoken = summarySpoken(item.label, summary, line);
        return (
          <Pressable
            key={item.id}
            testID={`mode-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={spoken}
            accessibilityState={{ selected: on }}
            style={[styles.modeChip, on && styles.modeChipOn, props.night && !on && styles.modeChipNight]}
            onPress={() => { Keyboard.dismiss(); props.onSelect(item.id); }}
          >
            <MaterialCommunityIcons name={item.icon} size={22} color={on ? "#fff" : props.night ? "#f2f2f7" : "#1c1c1e"} />
            <Text
              testID={`mode-eta-${item.id}`}
              numberOfLines={1}
              allowFontScaling={false}
              style={[styles.modeEta, on && styles.modeEtaOn, props.night && !on && styles.modeEtaNight]}
            >
              {line || " "}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function summaryLine(summary?: ModeSummary): string {
  if (!summary || summary.durationS == null) return summary?.failed ? "Unavailable" : "";
  const minutes = Math.max(1, Math.round(summary.durationS / 60));
  const time = minutes < 60
    ? `${minutes}\u00a0min`
    : `${Math.floor(minutes / 60)}\u00a0hr${minutes % 60 ? `\u00a0${minutes % 60}` : ""}`;
  if (summary.distanceM == null) return time;
  const distance = summary.distanceM < 950
    ? `${Math.max(1, Math.round(summary.distanceM))}\u00a0m`
    : `${(summary.distanceM / 1000).toFixed(1)}\u00a0km`;
  return `${time} · ${distance}`;
}

function summarySpoken(label: string, summary: ModeSummary | undefined, line: string): string {
  const readable = line.replace(/\u00a0/g, " ");
  const via = summary?.via === "car" ? ", car route" : "";
  return readable ? `${label}, ${readable}${via}` : label;
}

function ItineraryCard(props: { item: TransitItinerary; onStart?: () => void }) {
  const item = props.item;
  const minutes = item.duration_s == null ? "" : `${Math.max(1, Math.round(item.duration_s / 60))} min`;
  return (
    <View style={styles.card} testID="transit-card">
      <Text style={styles.cardTitle}>{minutes || "Transit"}</Text>
      <Text style={styles.note}>{item.scheduled === false ? "Live times" : "Scheduled"}{item.walk_min != null ? ` · ${item.walk_min} min walk` : ""}</Text>
      {item.legs.map((leg, index) => (
        <View key={`${leg.mode}-${index}`} style={styles.legRow}>
          <View style={[styles.swatch, leg.mode === "WALK" ? styles.swatchWalk : null, { backgroundColor: leg.mode === "WALK" ? "transparent" : (leg.draw_color || leg.color || "#5f6368"), borderColor: leg.draw_color || "#1a73e8" }]} />
          <Text style={styles.note}>
            {leg.mode === "WALK"
              ? walkCaption(leg)
              : `${legTitle(leg)}${leg.stop_count ? ` · ${leg.stop_count} stops` : ""}${leg.from_name && leg.to_name ? ` · ${leg.from_name} → ${leg.to_name}` : ""}`}
          </Text>
        </View>
      ))}
      {walkNotes(item.legs).map((note) => <Text key={note} style={styles.fine}>{note}</Text>)}
      {item.legs.some((leg) => leg.color_missing) ? <Text style={styles.fine}>Line colour was not provided by the agency.</Text> : null}
      {props.onStart ? (
        <Pressable style={styles.start} testID="route-start" onPress={props.onStart}>
          <Text style={styles.startText}>Start</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onFocus: () => void;
  inputRef?: Ref<TextInput>;
  returnKeyType?: "next" | "search";
  blurOnSubmit?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.kicker}>{props.label}</Text>
      <TextInput
        ref={props.inputRef}
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        onSubmitEditing={props.onSubmitEditing}
        returnKeyType={props.returnKeyType}
        blurOnSubmit={props.blurOnSubmit}
        enterKeyHint={props.returnKeyType === "search" ? "search" : "next"}
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
        <Pressable key={item.id || item.label} style={styles.suggestItem} onPress={() => { Keyboard.dismiss(); onPick(item); }}>
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

function RouteCard(props: { route: ScoredRoute; selected: boolean; onPress: () => void; onStart?: () => void }) {
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
      {props.onStart ? (
        <Pressable style={styles.start} testID="route-start" onPress={props.onStart}>
          <Text style={styles.startText}>Start</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    width: 300,
    maxWidth: "86%",
    maxHeight: "58%",
    marginRight: 12,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 16,
    overflow: "hidden",
  },
  sheetNight: { backgroundColor: "rgba(28,28,30,0.94)" },
  inkNight: { color: "#f2f2f7" },
  dev: { gap: 6, paddingTop: 4 },
  searchCard: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    zIndex: 20,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(120,120,128,0.45)",
    marginBottom: 8,
  },
  searchField: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  modeRow: { flexDirection: "row", alignItems: "stretch", gap: 6, paddingVertical: 8 },
  modeChip: {
    height: 58,
    minWidth: 76,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  modeChipNight: { backgroundColor: "rgba(44,44,46,0.9)" },
  modeChipOn: { backgroundColor: "#1a73e8" },
  modeEta: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: "#526072", textAlign: "center" },
  modeEtaNight: { color: "#aeaeb2" },
  modeEtaOn: { color: "#fff" },
  legRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  swatch: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  swatchWalk: { borderWidth: 2, borderStyle: "dashed" },
  searchPlaceholder: { flex: 1, fontSize: 17, fontWeight: "600" },
  searchScroll: { maxHeight: 320 },
  searchBody: { gap: 8, paddingTop: 8 },
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
  cameraRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  cameraBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: "#1a56db" },
  cameraBoxOn: { backgroundColor: "#1a56db" },
  cameraLabel: { fontSize: 15, fontWeight: "700", color: "#16191f" },
  cameraFine: { fontSize: 12, lineHeight: 16, color: "#526072" },
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
  start: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: "#1a73e8",
    alignItems: "center",
    justifyContent: "center",
  },
  startText: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
});
