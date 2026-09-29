import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Appearance, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { MapCanvas } from "./src/MapCanvas";
import { DeliveryPanel } from "./src/DeliveryPanel";
import { FeatureSheet, SearchCard } from "./src/FeatureSheet";
import { NavChrome, type ToolId } from "./src/NavChrome";
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
import {
  cutLine,
  etaCard,
  featuresAhead,
  featuresAlongRoute,
  navZoom,
  nextManeuver,
  pointAlong,
  progressAlong,
  shieldFrom,
  signAlert,
  smoothBearing,
  speedAlert,
  upcomingManeuvers,
  voiceCue,
  type LatLon,
  type Maneuver,
} from "./src/navCue";
import { nearestStep, previewFromStep } from "./src/roadPreview";
import { alertOverLimit } from "./src/overSpeedAlert";
import { loadMuted, loadReports, saveMuted, saveReport, type ReportKind, type RoadReport } from "./src/reports";
import { alertsAhead, CAMERA_DISCLAIMER, loadCameraAlerts, loadEnforcement, saveCameraAlerts, type CameraFeature } from "./src/cameras";
import { loadSignsNear, lookupStreet, type RoadSign } from "./src/roadSigns";
import { speakNav, stopSpeech } from "./src/voice";
import type { HeatSpot } from "./src/deliveryLogic";
import type {
  MapPreview,
  MapScene,
  MapSign,
  Place,
  PracticeLoop,
  RoadStep,
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
  const [tab, setTab] = useState<"trip" | "practice" | "fleet" | "delivery">("trip");
  const [heat, setHeat] = useState<HeatSpot[]>([]);
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
  const [routeSteps, setRouteSteps] = useState<RoadStep[][]>([]);
  const [preview, setPreview] = useState<MapPreview | null>(null);
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
  const [driving, setDriving] = useState(false);
  const [simCursor, setSimCursor] = useState<GpsFix | null>(null);
  const [mapHeld, setMapHeld] = useState(false);
  const [followToken, setFollowToken] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<ToolId | null>(null);
  const [mapHeading, setMapHeading] = useState(0);
  const [mapType, setMapType] = useState<"standard" | "mutedStandard" | "hybrid">("standard");
  const [northToken, setNorthToken] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reports, setReports] = useState<RoadReport[]>([]);
  const [muted, setMuted] = useState(false);
  const [headingUp, setHeadingUp] = useState(true);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [signs, setSigns] = useState<RoadSign[]>([]);
  const [cameras, setCameras] = useState<CameraFeature[]>([]);
  const [cameraAlerts, setCameraAlerts] = useState(true);
  const [turnStreet, setTurnStreet] = useState<string | null>(null);
  const spokenCues = useRef<Record<string, boolean>>({});
  const spokenSigns = useRef<Record<string, boolean>>({});
  const lastSignSpeech = useRef(0);
  const speedSpeech = useRef<{ spoken: boolean; at: number }>({ spoken: false, at: 0 });

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
    loadCameraAlerts().then((value) => { if (!cancelled) setCameraAlerts(value); }).catch(() => undefined);
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
  const travelFix = driving && speedMode === "simulate" && simCursor ? simCursor : fix;
  const userLat = travelFix?.lat ?? origin.lat ?? TORONTO.lat ?? 43.6532;
  const userLon = travelFix?.lon ?? origin.lon ?? TORONTO.lon ?? -79.3832;

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

  const matchRef = useRef<{ alongM: number } | null>(null);
  const bearingRef = useRef<number | null>(null);
  const puckRef = useRef({ lat: userLat, lon: userLon });
  const [puck, setPuck] = useState({ lat: userLat, lon: userLon });
  const [cameraHeading, setCameraHeading] = useState(0);

  const progress = useMemo(
    () => progressAlong(activeLine, userLat, userLon, matchRef.current),
    [activeLine, userLat, userLon],
  );

  useEffect(() => {
    if (!driving || speedMode !== "simulate" || activeLine.length < 2) return undefined;
    const line = activeLine;
    let along = 0;
    const start = pointAlong(line, 0);
    setSimCursor({
      lat: start.lat,
      lon: start.lon,
      accuracy: null,
      speedKmh: demoKmh,
      heading: start.bearing,
    });
    const timer = setInterval(() => {
      along += (demoKmh * 1000) / 3600;
      const point = pointAlong(line, along);
      setSimCursor({
        lat: point.lat,
        lon: point.lon,
        accuracy: null,
        speedKmh: demoKmh,
        heading: point.bearing,
      });
      if (point.done) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [driving, speedMode, activeLine, demoKmh]);

  const streetHint = turnStreet || speed?.road_name || "";
  const stepGuide = useMemo(() => {
    if (focus !== "nav" || activeLine.length < 2) {
      return { current: null as Maneuver | null, then: null as Maneuver | null, match: null, road: "" };
    }
    const steps = routeSteps[selected] || [];
    if (steps.length) return upcomingManeuvers(steps, activeLine, userLat, userLon, matchRef.current);
    const next = nextManeuver(progress.ahead, streetHint, destination.label);
    const named = next.street === "Unnamed road" && streetHint && streetHint !== "Unnamed road"
      ? { ...next, street: streetHint, shield: shieldFrom(streetHint) }
      : next;
    return { current: named, then: null as Maneuver | null, match: null, road: named.kind === "straight" ? named.street : "" };
  }, [focus, activeLine, routeSteps, selected, userLat, userLon, progress.ahead, streetHint, destination.label]);
  const maneuver = stepGuide.current;
  const signKey = `${userLat.toFixed(2)},${userLon.toFixed(2)},${driving ? "1" : "0"},${Math.round((stepGuide.match?.alongM || 0) / 500)},${activeLine.length}`;
  useEffect(() => {
    let cancelled = false;
    const ahead = driving && activeLine.length > 1
      ? cutLine(activeLine, stepGuide.match?.alongM || 0).ahead
      : [[userLat, userLon] as LatLon];
    loadSignsNear(userLat, userLon, ahead).then((next) => {
      if (!cancelled && next.length) setSigns(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [signKey]);

  useEffect(() => {
    let cancelled = false;
    const [lat, lon] = signKey.split(",").map(Number);
    loadEnforcement(lat, lon, API_BASE).then((next) => {
      if (!cancelled) setCameras(next);
    }).catch(() => {
      if (!cancelled) setCameras([]);
    });
    return () => { cancelled = true; };
  }, [signKey]);

  useEffect(() => {
    matchRef.current = driving && stepGuide.match ? { alongM: stepGuide.match.alongM } : null;
  }, [driving, stepGuide.match]);

  useEffect(() => {
    const targetLat = driving && stepGuide.match?.snapped ? stepGuide.match.lat : userLat;
    const targetLon = driving && stepGuide.match?.snapped ? stepGuide.match.lon : userLon;
    const from = { ...puckRef.current };
    const started = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / 900);
      const next = {
        lat: from.lat + (targetLat - from.lat) * t,
        lon: from.lon + (targetLon - from.lon) * t,
      };
      puckRef.current = next;
      setPuck(next);
      if (t >= 1) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [userLat, userLon, driving, stepGuide.match]);

  const turnKey = maneuver ? `${maneuver.atLat.toFixed(3)},${maneuver.atLon.toFixed(3)}` : "";
  useEffect(() => {
    const steps = routeSteps[selected] || [];
    if (steps.length || !maneuver || maneuver.kind === "straight") return undefined;
    let cancelled = false;
    lookupStreet(maneuver.atLat, maneuver.atLon).then((name) => {
      if (!cancelled && name) setTurnStreet(name);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [turnKey, maneuver, routeSteps, selected]);

  useEffect(() => {
    if (!driving || !maneuver || focus !== "nav") return;
    const cue = voiceCue(maneuver, speed?.road_mode, spokenCues.current);
    if (!cue) return;
    cue.mark.forEach((flag) => { spokenCues.current[flag] = true; });
    speakNav(cue.phrase, muted);
  }, [maneuver, muted, focus, driving, speed?.road_mode]);

  useEffect(() => {
    if (!driving || focus !== "nav" || !signs.length || activeLine.length < 2) return;
    const ahead = featuresAhead(signs, activeLine, userLat, userLon);
    const cue = signAlert(ahead, spokenSigns.current, Date.now(), lastSignSpeech.current, 8000);
    if (!cue) return;
    spokenSigns.current[cue.key] = true;
    lastSignSpeech.current = Date.now();
    speakNav(cue.phrase, muted);
  }, [driving, focus, signs, activeLine, userLat, userLon, muted]);

  const shownKmh = speedMode === "simulate"
    ? demoKmh
    : fix
      ? Math.max(0, Math.round(fix.speedKmh ?? 0))
      : null;
  const posted = speed?.posted_kmh ?? null;
  const safe = speed?.safe_kmh ?? null;
  const speedLevel: WarningLevel = warningFor(shownKmh, posted, safe);
  const warnRef = useRef<WarningLevel>("unknown");

  useEffect(() => {
    const cue = speedAlert(speedLevel, speedSpeech.current, Date.now());
    speedSpeech.current = cue.state;
    if (cue.speak) {
      alertOverLimit();
      speakNav(cue.phrase || "You are over the speed limit.", muted);
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

  const routeBearing = stepGuide.match?.bearing ?? progress.bearing;
  const gpsCourse = fix != null && fix.speedKmh != null && fix.speedKmh >= 8 && fix.heading != null && fix.heading >= 0
    ? fix.heading
    : null;
  const headingTarget = driving
    ? (gpsCourse ?? routeBearing)
    : deviceHeading != null && deviceHeading >= 0
      ? deviceHeading
      : routeBearing;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const step = () => {
      const next = smoothBearing(bearingRef.current, headingTarget, bearingRef.current == null ? 360 : 24);
      bearingRef.current = next;
      setCameraHeading(next);
      let delta = headingTarget - next;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      if (Math.abs(delta) < 1 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    step();
    timer = setInterval(step, 50);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [headingTarget]);
  const heading = cameraHeading;
  const spokenCameras = useRef<Record<string, boolean>>({});
  const lastCameraSpeech = useRef(0);
  useEffect(() => {
    if (!driving || !cameraAlerts || muted || !cameras.length) return;
    const route = focus === "nav" && progress.ahead.length >= 2 ? progress.ahead : [];
    const moving = fix != null && fix.speedKmh != null && fix.speedKmh > 3 && fix.heading != null && fix.heading >= 0;
    const alertHeading = route.length >= 2
      ? progress.bearing
      : moving
        ? fix!.heading
        : null;
    const next = alertsAhead(cameras, userLat, userLon, {
      heading: alertHeading,
      route,
      roadMode: speed?.road_mode,
      postedKmh: posted,
      spoken: spokenCameras.current,
    });
    if (!next.length || Date.now() - lastCameraSpeech.current < 8000) return;
    spokenCameras.current[next[0].id] = true;
    lastCameraSpeech.current = Date.now();
    speakNav(next[0].phrase, muted);
  }, [driving, cameraAlerts, muted, cameras, userLat, userLon, focus, progress, speed?.road_mode, posted, fix]);

  const routeAlertCount = useMemo(() => {
    if (focus !== "nav" || driving || activeLine.length < 2) return 0;
    const pins = [...signs, ...(cameraAlerts ? cameras : [])];
    return featuresAlongRoute(pins, activeLine).length;
  }, [focus, driving, activeLine, signs, cameras, cameraAlerts]);

  const scene: MapScene = useMemo(() => {
    const practiceSigns: MapSign[] = focus === "practice" && loop
      ? loop.points.filter((point) => point.kind === "signal" || point.kind === "stop").map((point) => ({
        lat: point.lat,
        lon: point.lon,
        kind: point.kind === "stop" ? "stop" as const : "signal" as const,
      }))
      : [];
    const reportPins: MapSign[] = reports.map((report) => ({ lat: report.lat, lon: report.lon, kind: "report" }));
    const cameraPins: MapSign[] = (cameraAlerts ? cameras : []).map((item) => ({
      lat: item.lat,
      lon: item.lon,
      kind: item.kind,
      label: item.limit_kmh ? String(item.limit_kmh) : item.kind === "variable" ? "VAR" : "",
    }));
    const roadPins: MapSign[] = signs.map((sign) => ({ lat: sign.lat, lon: sign.lon, kind: sign.kind }));
    let drawnSigns: MapSign[] = [...practiceSigns, ...reportPins];
    if (focus === "nav" && activeLine.length > 1) {
      const pool = [...roadPins, ...cameraPins];
      drawnSigns = driving
        ? [...drawnSigns, ...featuresAhead(pool, activeLine, userLat, userLon)]
        : [...drawnSigns, ...featuresAlongRoute(pool, activeLine).map((item) => ({ ...item, subtle: true }))];
    }
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
    const camera = driving ? "follow" : activeLine.length > 1 ? "fit" : "follow";
    const activeSteps = focus === "nav" ? (routeSteps[selected] || []) : [];
    return {
      routes: routesOut,
      markers: end && focus !== "idle"
        ? [{ lat: end[0], lon: end[1], label: "Destination", color: "#e23b2f" }]
        : [],
      signs: drawnSigns,
      user: {
        lat: driving ? puck.lat : userLat,
        lon: driving ? puck.lon : userLon,
        heading,
      },
      heat,
      camera,
      followToken,
      headingUp: camera === "follow" && headingUp,
      night,
      zoom: driving ? navZoom(shownKmh, maneuver?.distanceM ?? null) : 16,
      pitch: driving ? 52 : 0,
      driving,
      mapType,
      northToken,
      steps: activeSteps.map((step) => {
        const drawn = previewFromStep(step);
        return { name: drawn.name, coords: drawn.coords, lat: drawn.lat, lon: drawn.lon };
      }),
      preview: focus === "nav" ? preview : null,
    };
  }, [focus, driving, signs, cameras, cameraAlerts, progress, reports, geometries, selected, activeLine, userLat, userLon, puck, heading, headingUp, loop, night, heat, routeSteps, preview, followToken, shownKmh, maneuver, mapType, northToken]);

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
      setRouteSteps(drawn.map((route) => route.steps || []));
      setPreview(null);
      setTripLegs(drawn.map((route) => ({ distanceM: route.distance, durationS: route.duration })));
      const best = scored.best_route_index ?? ordered[0]?.route_index ?? 0;
      setSelected(best);
      setTurnStreet(null);
      spokenCues.current = {};
      spokenSigns.current = {};
      setDriving(false);
      setSimCursor(null);
      setFocus("nav");
      setMenuOpen(false);
      setPanel(null);
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
    setMenuOpen(false);
    setPanel("practice");
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
      setPanel(null);
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

  function startGuidance() {
    matchRef.current = null;
    bearingRef.current = null;
    setDriving(true);
    setFocus("nav");
    setMenuOpen(false);
    setPanel(null);
    setHeadingUp(true);
    setMapHeld(false);
    setFollowToken((value) => value + 1);
    spokenCues.current = {};
    spokenSigns.current = {};
  }

  function askExit() {
    Alert.alert("End route?", "This stops guidance.", [
      { text: "Keep going", style: "cancel" },
      { text: "End route", style: "destructive", onPress: exitDrive },
    ]);
  }

  function exitDrive() {
    if (fleet.running) stopTrip().catch(() => undefined);
    stopSpeech();
    spokenCues.current = {};
    spokenSigns.current = {};
    setDriving(false);
    setSimCursor(null);
    setMapHeld(false);
    setFocus("idle");
    setRoutes([]);
    setGeometries([]);
    setRouteSteps([]);
    setPreview(null);
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
  const remainingM = stepGuide.match?.remainingM ?? progress.aheadM;
  const totalM = leg?.distanceM || stepGuide.match?.totalM || progress.aheadM;
  const eta = focus === "nav"
    ? etaCard(remainingM, totalM, leg?.durationS || 0, destination.label)
    : null;
  const showExit = driving || focus === "practice" || focus === "fleet";
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

  function cycleMap() {
    setMapType((current) => current === "standard" ? "mutedStandard" : current === "mutedStandard" ? "hybrid" : "standard");
  }

  return (
    <SafeAreaProvider>
    <View style={styles.root}>
      <StatusBar style={night ? "light" : "dark"} />
      <MapCanvas
        scene={scene}
        onHeading={setMapHeading}
        onPan={() => { if (driving) setMapHeld(true); }}
        onRoutePoint={(lat, lon) => {
          const step = nearestStep(routeSteps[selected] || [], lat, lon);
          if (step) setPreview(previewFromStep(step));
        }}
      />
      <NavChrome
        maneuver={driving ? maneuver : null}
        thenManeuver={driving ? stepGuide.then : null}
        risk={driving && activeRoute?.safety_score != null ? String(activeRoute.safety_score) : ""}
        showRecenter={driving && mapHeld}
        onRecenter={() => { setMapHeld(false); setFollowToken((value) => value + 1); }}
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
        onMute={toggleMute}
        onGear={() => { setMenuOpen((open) => !open); setPanel(null); }}
        menuOpen={menuOpen}
        onMenu={(id) => {
          setMenuOpen(false);
          if (id === "practice") openPractice();
          else if (id === "settings") setPanel("settings");
          else { setTab(id); setPanel(id); }
        }}
        onLocate={() => { setMapHeld(false); setFollowToken((value) => value + 1); }}
        onLayers={cycleMap}
        onNorth={() => { setHeadingUp(true); setNorthToken((value) => value + 1); setMapHeading(0); }}
        mapRotated={Math.abs(mapHeading) > 8}
        onReport={() => { setReportNote(""); setReportOpen(true); }}
        onCloseReport={() => setReportOpen(false)}
        onSaveReport={(kind) => { storeReport(kind).catch(() => setReportNote("Could not save the report.")); }}
        driving={driving}
        roadName={(stepGuide.road && stepGuide.road !== "Unnamed road" ? stepGuide.road : "") || (speed?.road_name && speed.road_name !== "Unnamed road" ? speed.road_name : "")}
        arrival={eta?.arrival || ""}
        minutesLabel={eta?.minuteValue || ""}
        distanceLabel={eta?.distanceValue || ""}
        distanceUnit={eta?.distanceUnit || "km"}
        onExit={driving ? askExit : exitDrive}
        onWhereTo={() => undefined}
        night={night}
      />
      {!driving && focus !== "practice" && focus !== "fleet" ? (
        <SearchCard
          night={night}
          origin={origin}
          destination={destination}
          onOrigin={(label) => { setOrigin({ label, lat: null, lon: null }); setActiveField("origin"); }}
          onDestination={(label) => { setDestination({ label, lat: null, lon: null }); setActiveField("destination"); }}
          onFocusField={setActiveField}
          activeField={activeField}
          suggestions={suggestions}
          onPick={pickSuggestion}
          onUseLocation={() => { useMyLocation().catch(() => setStatus("Location is off. Type a start address instead.")); }}
          busy={busy}
          onFind={() => { findRoute().catch(() => undefined); }}
          routes={routes}
          selected={selected}
          onSelect={(index) => { setSelected(index); setPreview(null); }}
          onStart={routes.length ? startGuidance : undefined}
        />
      ) : null}
      {panel ? (
        <FeatureSheet
          tab={panel}
          night={night}
          topInset={118}
          muted={muted}
          onMute={toggleMute}
          onTab={(next) => { if (next === "practice") openPractice(); else if (next !== "settings") setTab(next); }}
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
          onSelect={(index) => { setSelected(index); setPreview(null); }}
          steps={routeSteps[selected] || []}
          onPreviewStep={(index) => {
            const step = (routeSteps[selected] || [])[index];
            if (step) setPreview(previewFromStep(step));
          }}
          onClearPreview={() => setPreview(null)}
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
          onClose={() => setPanel(null)}
          cameraAlerts={cameraAlerts}
          onCameraAlerts={(enabled) => {
            setCameraAlerts(enabled);
            saveCameraAlerts(enabled).catch(() => undefined);
          }}
          cameraNote={CAMERA_DISCLAIMER}
          routeAlertCount={routeAlertCount}
          onStart={startGuidance}
          delivery={panel === "delivery" ? (
            <DeliveryPanel
              lat={userLat}
              lon={userLon}
              trips={fleet.trips}
              recording={fleet.running}
              onHeat={(spots) => setHeat(spots)}
            />
          ) : null}
        />
      ) : null}
    </View>
    </SafeAreaProvider>
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
