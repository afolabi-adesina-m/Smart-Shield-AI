import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { WebView } from "react-native-webview";
import { DARK_MAP_STYLE } from "./darkMapStyle";
import { MAP_HTML } from "./mapHtml";
import { StopSign } from "./StopSign";
import { stopLayout } from "./stopSign";
import type { MapScene, MapSign } from "./types";

type Props = {
  scene: MapScene;
  onRoutePoint?: (lat: number, lon: number) => void;
  onPan?: () => void;
  onHeading?: (heading: number) => void;
  onMapPress?: () => void;
};

/** MapKit ignores `zoom`. Altitude is the distance that keeps a street in view. */
export function altitudeForZoom(zoom: number, latitude: number): number {
  const spanM = 800 * Math.pow(2, 16 - zoom);
  const fov = (30 * Math.PI) / 180;
  const altitude = (spanM / 2) / Math.tan(fov / 2);
  const latScale = Math.max(0.35, Math.cos((latitude * Math.PI) / 180));
  return Math.max(120, altitude * latScale);
}

const STREET_DELTA = 0.008;

/**
 * Phone map inside Expo Go. iPhone uses Apple MapKit (no API key). Android uses
 * Google Maps with Expo Go's development key. The OpenStreetMap page in mapHtml
 * is only used if the native map fails to mount. The browser uses MapCanvas.web.tsx.
 */
export function MapCanvas({ scene, onRoutePoint, onPan, onHeading, onMapPress }: Props) {
  const [nativeFailed, setNativeFailed] = useState(false);
  if (nativeFailed) {
    return <WebMapFallback scene={scene} onRoutePoint={onRoutePoint} onPan={onPan} onMapPress={onMapPress} />;
  }
  return (
    <NativeMap
      scene={scene}
      onRoutePoint={onRoutePoint}
      onPan={onPan}
      onHeading={onHeading}
      onMapPress={onMapPress}
      onNativeError={() => setNativeFailed(true)}
    />
  );
}

function NativeMap({ scene, onRoutePoint, onPan, onHeading, onMapPress, onNativeError }: Props & { onNativeError: () => void }) {
  const mapRef = useRef<MapView>(null);
  const latest = useRef(scene);
  latest.current = scene;
  const held = useRef(false);
  const token = useRef(scene.followToken || 0);
  const northToken = useRef(scene.northToken || 0);
  const centered = useRef(false);
  const [tracking, setTracking] = useState(true);
  const user = scene.user;
  const driving = !!scene.driving;
  const failRef = useRef(onNativeError);
  failRef.current = onNativeError;
  const headingRef = useRef(onHeading);
  headingRef.current = onHeading;

  useEffect(() => {
    const next = latest.current;
    const map = mapRef.current;
    if ((next.followToken || 0) !== token.current) {
      token.current = next.followToken || 0;
      held.current = false;
      centered.current = false;
      setTracking(true);
    }
    if ((next.northToken || 0) !== northToken.current) {
      northToken.current = next.northToken || 0;
      map?.animateCamera({ heading: 0, pitch: next.driving ? (next.pitch ?? 52) : 0 }, { duration: 280 });
    }
    if (!map || !next.user) return;
    if (next.camera === "fit") {
      const points = next.routes.flatMap((route) => route.coords.map(([lat, lon]) => ({
        latitude: lat,
        longitude: lon,
      })));
      if (next.user) points.push({ latitude: next.user.lat, longitude: next.user.lon });
      if (points.length > 1) {
        map.fitToCoordinates(points, {
          edgePadding: { top: 140, right: 72, bottom: 180, left: 40 },
          animated: false,
        });
      }
      return;
    }
    if (held.current && !next.driving) return;
    const drivingNow = !!next.driving;
    if (!drivingNow) {
      if (centered.current) return;
      centered.current = true;
      map.animateToRegion({
        latitude: next.user.lat,
        longitude: next.user.lon,
        latitudeDelta: STREET_DELTA,
        longitudeDelta: STREET_DELTA,
      }, 280);
      return;
    }
    const zoom = next.zoom ?? 17;
    try {
      map.animateCamera({
        center: { latitude: next.user.lat, longitude: next.user.lon },
        heading: next.headingUp ? next.user.heading : 0,
        pitch: next.pitch ?? 52,
        zoom,
        altitude: altitudeForZoom(zoom, next.user.lat),
      }, { duration: 700 });
    } catch {
      failRef.current();
    }
  }, [scene]);

  return (
    <View style={[styles.wrap, { backgroundColor: scene.night ? "#0e1620" : "#e7eef2" }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        userInterfaceStyle={scene.night ? "dark" : "light"}
        customMapStyle={Platform.OS === "android" ? (scene.night ? DARK_MAP_STYLE : []) : undefined}
        mapType={scene.mapType || "standard"}
        showsUserLocation={!driving}
        followsUserLocation={!driving && tracking}
        showsCompass={false}
        showsBuildings
        showsPointsOfInterests
        toolbarEnabled={false}
        rotateEnabled
        pitchEnabled
        onMapReady={() => {
          const here = latest.current.user;
          if (!here || latest.current.driving) return;
          mapRef.current?.animateToRegion({
            latitude: here.lat,
            longitude: here.lon,
            latitudeDelta: STREET_DELTA,
            longitudeDelta: STREET_DELTA,
          }, 0);
        }}
        onPress={() => onMapPress?.()}
        onPanDrag={() => {
          held.current = true;
          setTracking(false);
          onPan?.();
        }}
        onRegionChangeComplete={() => {
          mapRef.current?.getCamera().then((camera) => {
            if (camera && typeof camera.heading === "number") headingRef.current?.(camera.heading);
          }).catch(() => undefined);
        }}
        mapPadding={{ top: 108, right: 64, bottom: 140, left: 12 }}
        initialRegion={{
          latitude: user?.lat ?? 43.6532,
          longitude: user?.lon ?? -79.3832,
          latitudeDelta: STREET_DELTA,
          longitudeDelta: STREET_DELTA,
        }}
      >
        {scene.heat.map((spot, index) => (
          <Circle
            key={`heat-${spot.kind}-${index}`}
            center={{ latitude: spot.lat, longitude: spot.lon }}
            radius={280}
            fillColor={spot.kind === "order"
              ? `rgba(26,86,219,${(0.45 + spot.weight * 0.4).toFixed(2)})`
              : `rgba(226,59,47,${(0.4 + spot.weight * 0.45).toFixed(2)})`}
            strokeColor="transparent"
          />
        ))}
        {scene.routes.map((route, index) => {
          if (route.dashed) return null;
          const coords = route.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
          const traveled = !route.active && route.color === "#9bb0c9";
          if (!route.active) {
            return (
              <Polyline
                key={`route-${index}`}
                coordinates={coords}
                strokeColor={route.color}
                strokeWidth={traveled ? 8 : 5}
              />
            );
          }
          return (
            <Polyline
              key={`route-case-${index}`}
              coordinates={coords}
              strokeColor="#123a66"
              strokeWidth={14}
            />
          );
        })}
        {scene.routes.map((route, index) => route.active ? (
          <Polyline
            key={`route-core-${index}`}
            coordinates={route.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={route.color || "#4da3ff"}
            strokeWidth={route.dashed ? 5 : 8}
            lineCap={route.dashed ? "round" : "butt"}
            lineDashPattern={route.dashed ? [2, 10] : undefined}
          />
        ) : null)}
        {scene.routes.map((route, index) => route.active ? (
          <Polyline
            key={`route-hit-${index}`}
            coordinates={route.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
            strokeColor="rgba(77,163,255,0.01)"
            strokeWidth={28}
            tappable
            onPress={(event) => {
              const coordinate = event.nativeEvent.coordinate;
              if (coordinate && onRoutePoint) onRoutePoint(coordinate.latitude, coordinate.longitude);
            }}
          />
        ) : null)}
        {scene.preview && scene.preview.coords.length >= 2 ? (
          <Polyline
            key="road-preview"
            coordinates={scene.preview.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
            strokeColor="#f5c542"
            strokeWidth={10}
          />
        ) : null}
        {scene.preview ? (
          <Marker
            key="road-preview-point"
            coordinate={{ latitude: scene.preview.lat, longitude: scene.preview.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={scene.preview.name}
            zIndex={7}
          >
            <View style={styles.previewDot} />
          </Marker>
        ) : null}
        {scene.markers.map((marker, index) => (
          <Marker
            key={`pin-${index}`}
            coordinate={{ latitude: marker.lat, longitude: marker.lon }}
            pinColor={marker.color}
            title={marker.label}
          />
        ))}
        {scene.signs.map((sign, index) => {
          const stop = sign.kind === "stop" || sign.kind === "stop-all" ? stopLayout(sign.kind === "stop-all") : null;
          return (
            <Marker
              key={`sign-${sign.kind}-${index}`}
              coordinate={{ latitude: sign.lat, longitude: sign.lon }}
              anchor={{ x: stop ? stop.anchorX : 0.5, y: stop ? stop.anchorY : 0.5 }}
              tracksViewChanges={stop != null}
            >
              <View style={styles.signScale}>
                <SignView sign={sign} />
              </View>
            </Marker>
          );
        })}
        {driving && user ? (
          <Marker
            coordinate={{ latitude: user.lat, longitude: user.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={scene.headingUp ? 0 : user.heading}
            zIndex={8}
          >
            <Puck mode={scene.travelMode} />
          </Marker>
        ) : null}
      </MapView>
      {scene.preview ? (
        <View style={styles.previewChip} pointerEvents="none">
          <Text style={styles.previewChipText}>{scene.preview.name}</Text>
        </View>
      ) : null}
    </View>
  );
}

function WebMapFallback({ scene, onRoutePoint, onPan, onMapPress }: Props) {
  const webRef = useRef<WebView>(null);
  const latest = useRef(scene);
  latest.current = scene;

  function push(next: MapScene) {
    const payload = JSON.stringify(next).replace(/</g, "\\u003c");
    webRef.current?.injectJavaScript(`window.applyScene && window.applyScene(${payload}); true;`);
  }

  useEffect(() => {
    push(scene);
  }, [scene]);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: MAP_HTML }}
        onLoadEnd={() => push(latest.current)}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { type?: string; lat?: number; lon?: number };
            if (data.type === "smartshield-map-pan") onPan?.();
            if (data.type === "smartshield-map-press") onMapPress?.();
            if (data.type === "smartshield-route-press" && data.lat != null && data.lon != null) {
              onRoutePoint?.(data.lat, data.lon);
            }
          } catch {
            /* Ignore a frame that is not a map event. */
          }
        }}
      />
    </View>
  );
}

function Puck({ mode }: { mode?: string }) {
  if (mode === "walk" || mode === "cycle") {
    return <View style={[styles.person, mode === "cycle" && styles.cyclePuck]} />;
  }
  return (
    <View style={styles.puck}>
      <View style={styles.arrow} />
    </View>
  );
}

function SignView({ sign }: { sign: MapSign }) {
  if (sign.subtle) return <View style={styles.subtleDot} />;
  if (sign.kind === "red_light") {
    return (
      <View style={styles.cam}>
        <View style={[styles.lens, styles.lensRed]} />
      </View>
    );
  }
  if (sign.kind === "speed_camera") {
    return (
      <View style={styles.cam}>
        {sign.label ? <Text style={styles.camText}>{sign.label}</Text> : <View style={[styles.lens, styles.lensAmber]} />}
      </View>
    );
  }
  if (sign.kind === "variable") {
    return (
      <View style={styles.varSign}>
        <Text style={styles.camText}>{sign.label || "VAR"}</Text>
      </View>
    );
  }
  if (sign.kind === "signal") {
    return (
      <View style={styles.signal}>
        <View style={styles.lamp} />
        <View style={[styles.lamp, styles.lampOn]} />
        <View style={styles.lamp} />
      </View>
    );
  }
  if (sign.kind === "report") return <View style={styles.report} />;
  return <StopSign allWay={sign.kind === "stop-all"} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
  puck: { width: 28, height: 28, alignItems: "center", justifyContent: "flex-start" },
  person: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#1a73e8",
    borderWidth: 3,
    borderColor: "#fff",
  },
  cyclePuck: { borderRadius: 4, backgroundColor: "#188038" },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 22,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#1a73e8",
  },
  signScale: { transform: [{ scale: 0.72 }] },
  subtleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f5c542",
    borderWidth: 1,
    borderColor: "#ffffff",
  },
  cam: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  lens: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: "#3a3a3a" },
  lensRed: { backgroundColor: "#d93025" },
  lensAmber: { backgroundColor: "#f5c542" },
  varSign: {
    width: 34,
    height: 18,
    borderRadius: 3,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  camText: { color: "#f5c542", fontSize: 9, fontWeight: "700" },
  signal: {
    width: 12,
    height: 26,
    borderRadius: 3,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 2,
  },
  lamp: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#3a3a3a" },
  lampOn: { backgroundColor: "#3ddc6a" },
  report: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#f5c542",
  },
  previewDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#14685c",
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  previewChip: {
    position: "absolute",
    top: 120,
    alignSelf: "center",
    backgroundColor: "#16191f",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewChipText: { color: "#ffffff", fontWeight: "700" },
});
