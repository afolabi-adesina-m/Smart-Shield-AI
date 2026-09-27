import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { MapCanvas } from "./src/MapCanvas";
import {
  ApiError,
  buildLoop,
  fetchCentres,
  fetchDirections,
  fetchHealth,
  fetchSpeed,
  geocodePlace,
  scoreRoutes,
  suggestPlaces,
} from "./src/api";
import { API_BASE, COLD_START_HINT } from "./src/config";
import type {
  MapScene,
  Place,
  PracticeLoop,
  ScoredRoute,
  SpeedReading,
  Suggestion,
  TestCentre,
} from "./src/types";

const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#9334e6"];
const WEATHER = [
  { id: "auto", label: "Auto" },
  { id: "clear", label: "Clear" },
  { id: "wet", label: "Wet" },
  { id: "blizzard", label: "Blizzard" },
  { id: "ice_storm", label: "Ice" },
] as const;

const TORONTO: Place = { label: "Toronto, Ontario", lat: 43.6532, lon: -79.3832 };
const BARRIE: Place = { label: "Barrie, Ontario", lat: 44.3894, lon: -79.6903 };

export default function App() {
  const [tab, setTab] = useState<"trip" | "practice">("trip");
  const [origin, setOrigin] = useState<Place>(TORONTO);
  const [destination, setDestination] = useState<Place>(BARRIE);
  const [activeField, setActiveField] = useState<"origin" | "destination" | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [weather, setWeather] = useState<string>("auto");
  const [status, setStatus] = useState("Set a start and a destination.");
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(true);
  const [engineNote, setEngineNote] = useState("Checking the server…");
  const [routes, setRoutes] = useState<ScoredRoute[]>([]);
  const [geometries, setGeometries] = useState<[number, number][][]>([]);
  const [selected, setSelected] = useState(0);
  const [speed, setSpeed] = useState<SpeedReading | null>(null);
  const [demoKmh, setDemoKmh] = useState(70);
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [centreId, setCentreId] = useState("downsview");
  const [level, setLevel] = useState<"G2" | "G">("G2");
  const [loop, setLoop] = useState<PracticeLoop | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        const mode = health.engine?.mode || "unknown";
        setEngineNote(health.engine?.locked ? "Engine locked" : `Engine ${mode}`);
      } catch {
        if (!cancelled) setEngineNote("Server did not answer");
      } finally {
        if (!cancelled) setWaking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const place = activeField === "destination" ? destination : origin;
    if (!activeField || place.label.trim().length < 3 || place.lat != null) {
      setSuggestions([]);
      return;
    }
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => {
      suggestPlaces(place.label).then(setSuggestions).catch(() => setSuggestions([]));
    }, 300);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [activeField, origin, destination]);

  const scene: MapScene = useMemo(() => {
    if (tab === "practice" && loop) {
      return {
        routes: [{
          coords: loop.geometry.map(([lon, lat]) => [lat, lon]),
          color: "#6d28d9",
          active: true,
        }],
        markers: [
          { lat: loop.centre.lat || 0, lon: loop.centre.lon || 0, label: "Start", color: "#1a56db" },
          ...loop.points.slice(0, 12).map((point) => ({
            lat: point.lat,
            lon: point.lon,
            label: point.label,
            color: point.kind === "stop" ? "#b3261e" : "#0d7a45",
          })),
        ],
      };
    }
    return {
      routes: geometries.map((line, index) => ({
        coords: line.map(([lon, lat]) => [lat, lon]),
        color: ROUTE_COLORS[index % ROUTE_COLORS.length],
        active: index === selected,
      })),
      markers: [origin, destination]
        .filter((place) => place.lat != null && place.lon != null)
        .map((place, index) => ({
          lat: place.lat as number,
          lon: place.lon as number,
          label: index === 0 ? "From" : "To",
          color: index === 0 ? "#0d7a45" : "#b3261e",
        })),
    };
  }, [tab, loop, geometries, selected, origin, destination]);

  function pickSuggestion(item: Suggestion) {
    const place: Place = { id: item.id, label: item.label, detail: item.detail, lat: item.lat, lon: item.lon };
    if (activeField === "destination") setDestination(place);
    else setOrigin(place);
    setSuggestions([]);
    setActiveField(null);
  }

  async function useMyLocation() {
    setStatus("Asking for your location…");
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setStatus("Location is off. Type a start address instead.");
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const place: Place = {
      label: "My location",
      lat: position.coords.latitude,
      lon: position.coords.longitude,
    };
    setOrigin(place);
    setStatus("Start set to your location.");
    loadSpeed(place.lat as number, place.lon as number);
  }

  async function loadSpeed(lat: number, lon: number, tier?: string) {
    try {
      const reading = await fetchSpeed(lat, lon, tier, weather);
      setSpeed(reading);
    } catch {
      /* The speed card can stay on the last reading. */
    }
  }

  async function ensureCoords(place: Place): Promise<Place> {
    if (place.lat != null && place.lon != null) return place;
    const suggestions = await suggestPlaces(place.label).catch(() => []);
    const hinted = suggestions.find((item) => item.lat != null && item.lon != null);
    if (hinted && hinted.lat != null && hinted.lon != null) {
      return { ...place, label: hinted.label || place.label, lat: hinted.lat, lon: hinted.lon };
    }
    const hit = await geocodePlace(place.label);
    return { ...place, label: hit.label || place.label, lat: hit.lat, lon: hit.lon };
  }

  async function findRoute() {
    setBusy(true);
    setWaking(true);
    setLoop(null);
    setTab("trip");
    setStatus("Finding the drive… " + COLD_START_HINT);
    try {
      const from = await ensureCoords(origin);
      const to = await ensureCoords(destination);
      setOrigin(from);
      setDestination(to);
      if (from.lat == null || to.lat == null) throw new ApiError("Need a start and a destination.");
      setStatus("Drawing the roads…");
      const drawn = await fetchDirections(from, to);
      if (!drawn.length) throw new ApiError("No driving route was found.");
      setStatus("Scoring safety…");
      const scored = await scoreRoutes(drawn, weather);
      const ordered = scored.routes || [];
      setRoutes(ordered);
      setGeometries(drawn.map((route) => route.geometry));
      const best = scored.best_route_index ?? ordered[0]?.route_index ?? 0;
      setSelected(best);
      setStatus(ordered.length === 1 ? "1 route scored." : `${ordered.length} routes scored.`);
      const chosen = ordered.find((route) => route.route_index === best) || ordered[0];
      await loadSpeed(from.lat, from.lon as number, chosen?.tier);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not score the route.");
    } finally {
      setBusy(false);
      setWaking(false);
    }
  }

  async function openPractice() {
    setTab("practice");
    if (centres.length) return;
    setStatus("Loading DriveTest centres…");
    try {
      const data = await fetchCentres();
      setCentres(data.centres);
      setDisclaimer(data.disclaimer);
      if (data.centres.some((centre) => centre.id === "downsview")) setCentreId("downsview");
      else if (data.centres[0]) setCentreId(data.centres[0].id);
      setStatus("Pick a centre, then build a practice loop.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load centres.");
    }
  }

  async function makeLoop() {
    setBusy(true);
    setWaking(true);
    setStatus("Building a practice loop… This can take half a minute.");
    try {
      const data = await buildLoop(centreId, level);
      setLoop(data);
      if (data.disclaimer) setDisclaimer(data.disclaimer);
      const km = (data.distance_m / 1000).toFixed(1);
      setStatus(`${data.centre.name} · ${data.level} · ${km} km loop.`);
      if (data.centre.lat != null && data.centre.lon != null) {
        await loadSpeed(data.centre.lat, data.centre.lon);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not build a loop.");
    } finally {
      setBusy(false);
      setWaking(false);
    }
  }

  const posted = speed?.posted_kmh;
  const safe = speed?.safe_kmh;
  const over = posted != null && demoKmh > posted;
  const aboveSafe = safe != null && demoKmh > safe && !over;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.mapPane}>
        <MapCanvas scene={scene} />
        <View style={styles.topChip}>
          <Text style={styles.brand}>Smart-Shield</Text>
          <Text style={styles.engine}>{waking ? "Contacting server…" : engineNote}</Text>
        </View>
        <View style={styles.speedCard}>
          <SpeedStat label="Limit" value={posted == null ? "—" : String(posted)} />
          <SpeedStat label="Your speed" value={String(demoKmh)} warn={aboveSafe} danger={over} />
          <SpeedStat label="Safe" value={safe == null ? "—" : String(safe)} />
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.tabs}>
          <Tab label="Trip" active={tab === "trip"} onPress={() => setTab("trip")} />
          <Tab label="Practice" active={tab === "practice"} onPress={openPractice} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
          {tab === "trip" ? (
            <>
              <Field
                label="From"
                value={origin.label}
                onChangeText={(label) => {
                  setOrigin({ label, lat: null, lon: null });
                  setActiveField("origin");
                }}
                onFocus={() => setActiveField("origin")}
              />
              {activeField === "origin" ? <SuggestList items={suggestions} onPick={pickSuggestion} /> : null}
              <Field
                label="To"
                value={destination.label}
                onChangeText={(label) => {
                  setDestination({ label, lat: null, lon: null });
                  setActiveField("destination");
                }}
                onFocus={() => setActiveField("destination")}
              />
              {activeField === "destination" ? <SuggestList items={suggestions} onPick={pickSuggestion} /> : null}
              <Pressable style={styles.secondary} onPress={useMyLocation}>
                <Text style={styles.secondaryText}>Use my location as start</Text>
              </Pressable>
              <Text style={styles.kicker}>Road conditions</Text>
              <View style={styles.chips}>
                {WEATHER.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.chip, weather === item.id && styles.chipOn]}
                    onPress={() => setWeather(item.id)}
                  >
                    <Text style={[styles.chipText, weather === item.id && styles.chipTextOn]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={findRoute}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Find safest route</Text>}
              </Pressable>
              {routes.map((route) => (
                <RouteCard
                  key={route.route_index}
                  route={route}
                  selected={route.route_index === selected}
                  onPress={() => setSelected(route.route_index)}
                />
              ))}
            </>
          ) : (
            <>
              <Text style={styles.kicker}>DriveTest centre</Text>
              <View style={styles.chips}>
                {centres.map((centre) => (
                  <Pressable
                    key={centre.id}
                    style={[styles.chip, centreId === centre.id && styles.chipOn]}
                    onPress={() => setCentreId(centre.id)}
                  >
                    <Text style={[styles.chipText, centreId === centre.id && styles.chipTextOn]}>{centre.name}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.chips}>
                {(["G2", "G"] as const).map((item) => (
                  <Pressable key={item} style={[styles.chip, level === item && styles.chipOn]} onPress={() => setLevel(item)}>
                    <Text style={[styles.chipText, level === item && styles.chipTextOn]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy || !centreId} onPress={makeLoop}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Build practice loop</Text>}
              </Pressable>
              {disclaimer ? <Text style={styles.note}>{disclaimer}</Text> : null}
              {loop?.points.map((point, index) => (
                <Text key={`${point.kind}-${index}`} style={styles.point}>{point.label}</Text>
              ))}
            </>
          )}
          <Text style={styles.status}>{status}</Text>
          <View style={styles.sliderRow}>
            <Text style={styles.kicker}>Demo speed {demoKmh} km/h</Text>
            <View style={styles.slider}>
              {[40, 60, 80, 100, 120].map((value) => (
                <Pressable key={value} style={[styles.chip, demoKmh === value && styles.chipOn]} onPress={() => setDemoKmh(value)}>
                  <Text style={[styles.chipText, demoKmh === value && styles.chipTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>
            {speed?.road_name ? <Text style={styles.note}>{speed.road_name}</Text> : null}
            {speed?.summary ? <Text style={styles.note}>{speed.summary}</Text> : null}
          </View>
          <Text style={styles.fine}>API {API_BASE}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onFocus: () => void;
}) {
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

function SpeedStat(props: { label: string; value: string; warn?: boolean; danger?: boolean }) {
  return (
    <View style={styles.speedStat}>
      <Text style={styles.speedLabel}>{props.label}</Text>
      <Text style={[styles.speedValue, props.warn && styles.warn, props.danger && styles.danger]}>{props.value}</Text>
    </View>
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
  root: { flex: 1, backgroundColor: "#e8edf3" },
  mapPane: { flex: 1, minHeight: 220 },
  topChip: {
    position: "absolute",
    top: 12,
    left: 12,
    pointerEvents: "none",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
  },
  brand: { fontWeight: "700", color: "#16191f", fontSize: 14 },
  engine: { color: "#526072", fontSize: 12, marginTop: 2 },
  speedCard: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
  },
  speedStat: { minWidth: 64 },
  speedLabel: { fontSize: 11, color: "#526072", fontWeight: "600" },
  speedValue: { fontSize: 22, fontWeight: "700", color: "#16191f" },
  warn: { color: "#8a5a00" },
  danger: { color: "#b3261e" },
  sheet: {
    maxHeight: "58%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.08)",
  },
  tabs: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 0 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#eef2f7" },
  tabOn: { backgroundColor: "#1a56db" },
  tabText: { fontWeight: "700", color: "#526072" },
  tabTextOn: { color: "#ffffff" },
  sheetBody: { padding: 12, paddingBottom: 28, gap: 8 },
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
    marginTop: 4,
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
  secondary: { alignSelf: "flex-start", paddingVertical: 6 },
  secondaryText: { color: "#1a56db", fontWeight: "700" },
  disabled: { opacity: 0.6 },
  card: {
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    borderRadius: 16,
    padding: 12,
    gap: 4,
    marginTop: 4,
  },
  cardOn: { borderColor: "#1a56db" },
  cardHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontWeight: "700", color: "#16191f" },
  score: { fontSize: 22, fontWeight: "800" },
  tier: { color: "#16191f", fontWeight: "600" },
  note: { color: "#526072", fontSize: 13, lineHeight: 18 },
  point: { color: "#16191f", fontSize: 14, paddingVertical: 2 },
  status: { color: "#16191f", fontSize: 13, lineHeight: 18, marginTop: 6 },
  sliderRow: { gap: 8, marginTop: 8 },
  slider: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fine: { color: "#8b97a6", fontSize: 11 },
});
