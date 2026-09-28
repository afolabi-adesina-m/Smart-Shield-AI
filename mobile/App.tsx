import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Appearance, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { MapCanvas } from "./src/MapCanvas";
import { FeatureSheet } from "./src/FeatureSheet";
import { NavChrome } from "./src/NavChrome";
import {
  ApiError,
  buildLoop,
  fetchCentres,
  fetchDirections,
  fetchHealth,
  fetchRoadContext,
  fetchSpeed,
  geocodePlace,
  scoreRoutes,
  suggestPlaces,
} from "./src/api";
import { API_BASE, COLD_START_HINT } from "./src/config";
import { isNight } from "./src/dayNight";
import { haversineM, warningFor, type WarningLevel } from "./src/fleetLogic";
import { getFleetSnapshot, setLiveReader, stopTrip, subscribeFleet } from "./src/fleetStore";
import { etaCard, instructionSpeech, nextManeuver, progressAlong, shieldFrom, type LatLon } from "./src/navCue";
import { alertOverLimit } from "./src/overSpeedAlert";
import { loadMuted, loadReports, saveMuted, saveReport, type ReportKind, type RoadReport } from "./src/reports";
import { loadSignsNear, lookupStreet, signsAlong, type RoadSign } from "./src/roadSigns";
import { speakNav, stopSpeech } from "./src/voice";
import type {
  MapScene,
  MapSign,
  Place,
  PracticeLoop,
  ScoredRoute,
  SpeedReading,
  Suggestion,
  TestCentre,
} from "./src/types";

const TORONTO: Place = { label: "Toronto, Ontario", lat: 43.6532, lon: -79.3832 };
const BARRIE: Place = { label: "Barrie, Ontario", lat: 44.3894, lon: -79.6903 };

type GpsFix = {
  lat: number;
  lon: number;
  accuracy: number | null;
  speedKmh: number | null;
  heading: number | null;
};

type Focus = "idle" | "nav" | "practice" | "fleet";

type TripLeg = { distanceM: number; durationS: number };

export default function App() {
  const [tab, setTab] = useState<"trip" | "practice" | "fleet">("trip");
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
  const [tripLegs, setTripLegs] = useState<TripLeg[]>([]);
  const [selected, setSelected] = useState(0);
  const [speed, setSpeed] = useState<SpeedReading | null>(null);
  const [demoKmh, setDemoKmh] = useState(30);
  const [speedMode, setSpeedMode] = useState<"gps" | "simulate">(Platform.OS === "web" ? "simulate" : "gps");
  const [gpsNote, setGpsNote] = useState(Platform.OS === "web"
    ? "This browser has no travel speed. Simulate is on."
    : "Starting GPS…");
  const [fix, setFix] = useState<GpsFix | null>(null);
  const fleet = useSyncExternalStore(subscribeFleet, getFleetSnapshot, getFleetSnapshot);
  const wantGps = useRef(Platform.OS !== "web");
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [centreId, setCentreId] = useState("downsview");
  const [level, setLevel] = useState<"G2" | "G">("G2");
  const [loop, setLoop] = useState<PracticeLoop | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focus, setFocus] = useState<Focus>("idle");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reports, setReports] = useState<RoadReport[]>([]);
  const [muted, setMuted] = useState(false);
  const [headingUp, setHeadingUp] = useState(true);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [signs, setSigns] = useState<RoadSign[]>([]);
  const [turnStreet, setTurnStreet] = useState<string | null>(null);
  const spoken = useRef("");

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
    loadReports().then((saved) => { if (!cancelled) setReports(saved); }).catch(() => undefined);
    loadMuted().then((value) => { if (!cancelled) setMuted(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function beginGps() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setGpsNote("Location is off. Type a start, or simulate a speed.");
      setSpeedMode("simulate");
      wantGps.current = false;
      return;
    }
    if (watchRef.current) return;
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (position) => {
        const raw = position.coords.speed;
        const speedKmh = raw == null || raw < 0 ? null : Math.round(raw * 3.6);
        const accuracy = position.coords.accuracy;
        setFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy,
          speedKmh,
          heading: position.coords.heading,
        });
        if (!wantGps.current) return;
        setSpeedMode("gps");
        if (accuracy != null && accuracy > 50) setGpsNote("GPS accuracy is low. The limit may be for a nearby road.");
        else if (speedKmh == null) setGpsNote("No GPS speed yet. Wait for a fix, or simulate.");
        else setGpsNote("Live GPS speed");
      },
    );
  }

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    beginGps().catch(() => {
      setGpsNote("GPS did not start. Simulate a speed instead.");
      setSpeedMode("simulate");
    });
    return () => {
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, []);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((value) => {
      const deg = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
      if (deg >= 0) setDeviceHeading(deg);
    }).then((subscription) => {
      if (cancelled) subscription.remove();
      else sub = subscription;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      sub?.remove();
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

  const activeRoute = routes.find((route) => route.route_index === selected) || routes[0];
  const recommended = activeRoute?.recommended_speed_kmh ?? null;
  const lookupRef = useRef({ key: "", at: 0 });
  const userLat = fix?.lat ?? origin.lat ?? TORONTO.lat ?? 43.6532;
  const userLon = fix?.lon ?? origin.lon ?? TORONTO.lon ?? -79.3832;

  useEffect(() => {
    const lat = userLat;
    const lon = userLon;
    const moved = haversineM(
      lookupRef.current.key ? Number(lookupRef.current.key.split(",")[0]) : lat,
      lookupRef.current.key ? Number(lookupRef.current.key.split(",")[1]) : lon,
      lat,
      lon,
    );
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}|${weather}|${activeRoute?.tier || ""}|${recommended ?? ""}`;
    const samePlace = moved < 80 && lookupRef.current.key.startsWith(`${lat.toFixed(3)},${lon.toFixed(3)}`);
    const fresh = Date.now() - lookupRef.current.at < 12000;
    if (lookupRef.current.key === key || (samePlace && fresh && lookupRef.current.key.includes(`|${weather}|`))) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      const geometry = geometries[selected];
      const thin = geometry && geometry.length > 80
        ? geometry.filter((_, index) => index % Math.ceil(geometry.length / 80) === 0)
        : geometry;
      fetchRoadContext({
        lat,
        lon,
        weather,
        tier: activeRoute?.tier,
        recommended_kmh: recommended,
        bearing: fix?.heading,
        geometry: thin,
      }).then((reading) => {
        if (cancelled) return;
        setSpeed(reading);
        lookupRef.current = { key, at: Date.now() };
      }).catch(() => {
        fetchSpeed(lat, lon, activeRoute?.tier, weather).then((reading) => {
          if (!cancelled) setSpeed(reading);
        }).catch(() => undefined);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userLat, userLon, weather, activeRoute?.tier, recommended, geometries, selected, fix?.heading]);

  const signKey = `${userLat.toFixed(2)},${userLon.toFixed(2)}`;
  useEffect(() => {
    let cancelled = false;
    const [lat, lon] = signKey.split(",").map(Number);
    loadSignsNear(lat, lon).then((next) => {
      if (!cancelled) setSigns(next);
    }).catch(() => {
      if (!cancelled) setSigns([]);
    });
    return () => { cancelled = true; };
  }, [signKey]);

  const fleetWatch = useRef(fleet.status);
  useEffect(() => {
    if (fleet.status === fleetWatch.current) return;
    fleetWatch.current = fleet.status;
    if (focus === "nav") return;
    if (tab === "fleet" && (fleet.running || fleet.line.length > 1)) setFocus("fleet");
  }, [fleet.status, fleet.running, fleet.line.length, tab, focus]);

  const activeLine: LatLon[] = useMemo(() => {
    if (focus === "practice" && loop) return loop.geometry.map(([lon, lat]) => [lat, lon]);
    if (focus === "fleet" && fleet.line.length > 1) return fleet.line;
    if (focus === "nav" && geometries[selected]) return geometries[selected].map(([lon, lat]) => [lat, lon]);
    return [];
  }, [focus, loop, fleet.line, geometries, selected]);

  const progress = useMemo(
    () => progressAlong(activeLine, userLat, userLon),
    [activeLine, userLat, userLon],
  );

  const streetHint = turnStreet || speed?.road_name || "";
  const maneuver = useMemo(() => {
    if (focus !== "nav" || activeLine.length < 2) return null;
    const next = nextManeuver(progress.ahead, streetHint, destination.label);
    return { ...next, shield: next.shield || shieldFrom(streetHint) };
  }, [focus, activeLine.length, progress.ahead, streetHint, destination.label]);

  const turnKey = maneuver ? `${maneuver.atLat.toFixed(3)},${maneuver.atLon.toFixed(3)}` : "";
  useEffect(() => {
    if (!maneuver || maneuver.kind === "straight") return undefined;
    let cancelled = false;
    lookupStreet(maneuver.atLat, maneuver.atLon).then((name) => {
      if (!cancelled && name) setTurnStreet(name);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [turnKey, maneuver]);

  useEffect(() => {
    if (!maneuver || focus !== "nav") return;
    const bucket = maneuver.distanceM < 80 ? "now" : maneuver.distanceM < 300 ? "near" : maneuver.distanceM < 800 ? "mid" : "far";
    if (bucket === "far") return;
    const phrase = instructionSpeech(maneuver);
    const key = `${phrase}|${bucket}`;
    if (spoken.current === key) return;
    spoken.current = key;
    speakNav(phrase, muted);
  }, [maneuver, muted, focus]);

  const shownKmh = speedMode === "simulate" ? demoKmh : fix?.speedKmh ?? null;
  const posted = speed?.posted_kmh ?? null;
  const safe = speed?.safe_kmh ?? null;
  const speedLevel: WarningLevel = warningFor(shownKmh, posted, safe);
  const warnRef = useRef<WarningLevel>("unknown");

  useEffect(() => {
    if (speedLevel === "red" && warnRef.current !== "red") {
      alertOverLimit();
      speakNav("You are over the speed limit.", muted);
    }
    warnRef.current = speedLevel;
  }, [speedLevel, muted]);

  useEffect(() => {
    setLiveReader(() => {
      const lat = fix?.lat ?? origin.lat;
      const lon = fix?.lon ?? origin.lon;
      if (lat == null || lon == null || shownKmh == null || posted == null) return null;
      return {
        lat,
        lon,
        current_kmh: shownKmh,
        posted_kmh: posted,
        safe_kmh: safe,
        road_mode: speed?.road_mode,
        warning: speedLevel,
        school_active: !!speed?.school_active,
        exit_warning: speed?.exit_warning,
        hazards: speed?.hazards,
        source: speedMode === "gps" ? "gps" : "simulate",
      };
    });
  }, [fix, origin.lat, origin.lon, shownKmh, posted, safe, speed, speedLevel, speedMode]);

  const [night, setNight] = useState(() => nightAt(userLat, userLon));
  useEffect(() => {
    const update = () => setNight(nightAt(userLat, userLon));
    update();
    const timer = setInterval(update, 60000);
    const subscription = Appearance.addChangeListener(update);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [userLat, userLon]);

  const heading = fix != null && fix.speedKmh != null && fix.speedKmh > 3 && fix.heading != null && fix.heading >= 0
    ? fix.heading
    : deviceHeading != null && deviceHeading >= 0
      ? deviceHeading
      : progress.bearing;

  const scene: MapScene = useMemo(() => {
    const lineSigns = focus === "nav"
      ? signsAlong(signs, progress.ahead, 50)
      : signs.filter((sign) => haversineM(sign.lat, sign.lon, userLat, userLon) < 500);
    const practiceSigns: MapSign[] = focus === "practice" && loop
      ? loop.points.filter((point) => point.kind === "signal" || point.kind === "stop").map((point) => ({
        lat: point.lat,
        lon: point.lon,
        kind: point.kind === "stop" ? "stop" as const : "signal" as const,
      }))
      : [];
    const reportPins: MapSign[] = reports.map((report) => ({ lat: report.lat, lon: report.lon, kind: "report" }));
    const drawnSigns: MapSign[] = [...practiceSigns, ...lineSigns, ...reportPins];
    const routesOut: MapScene["routes"] = [];
    if (focus === "nav") {
      geometries.forEach((line, index) => {
        const latlon = line.map(([lon, lat]) => [lat, lon] as LatLon);
        if (index === selected) {
          if (progress.traveled.length > 1) routesOut.push({ coords: progress.traveled, color: "#9bb0c9", active: false });
          if (progress.ahead.length > 1) routesOut.push({ coords: progress.ahead, color: "#4da3ff", active: true });
        } else {
          routesOut.push({ coords: latlon, color: "#6d7c90", active: false });
        }
      });
    } else if (activeLine.length > 1) {
      routesOut.push({
        coords: activeLine,
        color: focus === "practice" ? "#c4b5fd" : "#4da3ff",
        active: true,
      });
    }
    const end = activeLine.length ? activeLine[activeLine.length - 1] : null;
    const camera = (sheetOpen && activeLine.length > 1) || focus === "practice" || focus === "fleet" ? "fit" : "follow";
    return {
      routes: routesOut,
      markers: end && focus !== "idle"
        ? [{ lat: end[0], lon: end[1], label: "Destination", color: "#e23b2f" }]
        : [],
      signs: drawnSigns,
      user: { lat: userLat, lon: userLon, heading },
      camera,
      headingUp: camera === "follow" && headingUp,
      night,
    };
  }, [focus, signs, progress, reports, geometries, selected, activeLine, sheetOpen, userLat, userLon, heading, headingUp, loop, night]);

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

  async function loadSpeed(lat: number, lon: number, tier?: string, recommendedKmh?: number | null) {
    try {
      const reading = await fetchRoadContext({ lat, lon, weather, tier, recommended_kmh: recommendedKmh });
      setSpeed(reading);
    } catch {
      try {
        const reading = await fetchSpeed(lat, lon, tier, weather);
        setSpeed(reading);
      } catch {
        /* The speed card can stay on the last reading. */
      }
    }
  }

  async function ensureCoords(place: Place): Promise<Place> {
    if (place.lat != null && place.lon != null) return place;
    const hinted = (await suggestPlaces(place.label).catch(() => [])).find((item) => item.lat != null && item.lon != null);
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
      setTripLegs(drawn.map((route) => ({ distanceM: route.distance, durationS: route.duration })));
      const best = scored.best_route_index ?? ordered[0]?.route_index ?? 0;
      setSelected(best);
      setTurnStreet(null);
      spoken.current = "";
      setFocus("nav");
      setSheetOpen(false);
      setStatus(ordered.length === 1 ? "1 route scored." : `${ordered.length} routes scored.`);
      const chosen = ordered.find((route) => route.route_index === best) || ordered[0];
      await loadSpeed(from.lat, from.lon as number, chosen?.tier, chosen?.recommended_speed_kmh);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not score the route.");
    } finally {
      setBusy(false);
      setWaking(false);
    }
  }

  async function openPractice() {
    setTab("practice");
    setSheetOpen(true);
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
      setFocus("practice");
      setSheetOpen(false);
      if (data.disclaimer) setDisclaimer(data.disclaimer);
      const km = (data.distance_m / 1000).toFixed(1);
      setStatus(`${data.centre.name} · ${data.level} · ${km} km loop.`);
      if (data.centre.lat != null && data.centre.lon != null) await loadSpeed(data.centre.lat, data.centre.lon);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not build a loop.");
    } finally {
      setBusy(false);
      setWaking(false);
    }
  }

  function exitDrive() {
    if (fleet.running) stopTrip().catch(() => undefined);
    stopSpeech();
    spoken.current = "";
    setFocus("idle");
    setRoutes([]);
    setGeometries([]);
    setTripLegs([]);
    setLoop(null);
    setStatus("Search a destination.");
  }

  async function storeReport(kind: ReportKind) {
    const next = await saveReport({ kind, lat: userLat, lon: userLon });
    setReports(next);
    setReportNote("Saved on this phone.");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (next) stopSpeech();
    saveMuted(next).catch(() => undefined);
  }

  const leg = tripLegs[selected];
  const totalM = leg?.distanceM || progress.aheadM;
  const eta = focus === "nav"
    ? etaCard(progress.aheadM, totalM, leg?.durationS || 0, destination.label)
    : null;
  const showExit = focus !== "idle";
  const etaTitle = focus === "fleet"
    ? `Score ${fleet.score}`
    : focus === "practice" && loop
      ? `${(loop.distance_m / 1000).toFixed(1)} km`
      : eta?.title || "Where to?";
  const etaSubtitle = focus === "fleet"
    ? fleet.status
    : focus === "practice"
      ? (status || "Practice loop")
      : eta?.subtitle || "Search a destination";

  const sheetStatus = waking && status.startsWith("Finding")
    ? status
    : engineNote && status === "Set a start and a destination."
      ? `${status} ${engineNote}`
      : status;

  return (
    <View style={styles.root}>
      <StatusBar style={night ? "light" : "dark"} />
      <MapCanvas scene={scene} />
      <NavChrome
        maneuver={focus === "nav" ? maneuver : null}
        posted={posted}
        current={shownKmh}
        safe={safe}
        level={speedLevel}
        etaTitle={etaTitle}
        etaSubtitle={etaSubtitle}
        showExit={showExit}
        heading={heading}
        muted={muted}
        reportOpen={reportOpen}
        reportNote={reportNote}
        onCompass={() => setHeadingUp((value) => !value)}
        onSearch={() => { setTab("trip"); setSheetOpen(true); }}
        onMute={toggleMute}
        onRoutes={() => { setTab("trip"); setSheetOpen(true); }}
        onReport={() => { setReportNote(""); setReportOpen(true); }}
        onCloseReport={() => setReportOpen(false)}
        onSaveReport={(kind) => { storeReport(kind).catch(() => setReportNote("Could not save the report.")); }}
        onExit={exitDrive}
        onWhereTo={() => { setTab("trip"); setSheetOpen(true); }}
        night={night}
      />
      {sheetOpen ? (
        <FeatureSheet
          tab={tab}
          onTab={(next) => { if (next === "practice") openPractice(); else setTab(next); }}
          origin={origin}
          destination={destination}
          onOrigin={(label) => { setOrigin({ label, lat: null, lon: null }); setActiveField("origin"); }}
          onDestination={(label) => { setDestination({ label, lat: null, lon: null }); setActiveField("destination"); }}
          onFocusField={setActiveField}
          activeField={activeField}
          suggestions={suggestions}
          onPick={pickSuggestion}
          onUseLocation={() => { useMyLocation().catch(() => setStatus("Location is off. Type a start address instead.")); }}
          weather={weather}
          onWeather={setWeather}
          busy={busy}
          onFind={() => { findRoute().catch(() => undefined); }}
          routes={routes}
          selected={selected}
          onSelect={setSelected}
          centres={centres}
          centreId={centreId}
          onCentre={setCentreId}
          level={level}
          onLevel={setLevel}
          onLoop={() => { makeLoop().catch(() => undefined); }}
          disclaimer={disclaimer}
          loop={loop}
          status={sheetStatus}
          speedMode={speedMode}
          demoKmh={demoKmh}
          gpsNote={gpsNote}
          onSimulate={() => { wantGps.current = false; setSpeedMode("simulate"); setGpsNote("Simulate is on. Pick a speed to test indoors."); }}
          onGps={() => { wantGps.current = true; setGpsNote("Asking for GPS…"); beginGps().catch(() => setGpsNote("Location is off. Simulate stays on.")); }}
          onSpeed={(value) => { wantGps.current = false; setSpeedMode("simulate"); setDemoKmh(value); }}
          speed={speed}
          recommended={recommended}
          apiBase={API_BASE}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

function nightAt(lat: number, lon: number): boolean {
  const bySun = isNight(lat, lon);
  if (bySun != null) return bySun;
  if (Appearance.getColorScheme() === "dark") return true;
  const hour = new Date().getHours();
  return hour < 7 || hour >= 19;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0e1620" },
});
