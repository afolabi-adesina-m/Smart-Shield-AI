import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import { DARK_MAP_STYLE } from "./darkMapStyle";
import { StopSign } from "./StopSign";
import { stopLayout } from "./stopSign";
import type { MapScene, MapSign } from "./types";

type Props = {
  scene: MapScene;
  onRoutePoint?: (lat: number, lon: number) => void;
  onPan?: () => void;
};

/**
 * Phone map inside Expo Go. iPhone uses Apple Maps. Android uses Google Maps
 * with Expo Go's built-in development key. The browser uses MapCanvas.web.tsx.
 */
export function MapCanvas({ scene, onRoutePoint, onPan }: Props) {
  const mapRef = useRef<MapView>(null);
  const latest = useRef(scene);
  latest.current = scene;
  const held = useRef(false);
  const token = useRef(scene.followToken || 0);
  const user = scene.user;

  useEffect(() => {
    const next = latest.current;
    const map = mapRef.current;
    if ((next.followToken || 0) !== token.current) {
      token.current = next.followToken || 0;
      held.current = false;
    }
    if (!map || !next.user) return;
    if (next.camera === "follow" && held.current) return;
    if (next.camera === "fit") {
      const points = next.routes.flatMap((route) => route.coords.map(([lat, lon]) => ({
        latitude: lat,
        longitude: lon,
      })));
      if (next.user) points.push({ latitude: next.user.lat, longitude: next.user.lon });
      if (points.length > 1) {
        map.fitToCoordinates(points, {
          edgePadding: { top: 140, right: 72, bottom: 160, left: 40 },
          animated: false,
        });
      }
      return;
    }
    map.animateCamera({
      center: { latitude: next.user.lat, longitude: next.user.lon },
      heading: next.headingUp ? next.user.heading : 0,
      pitch: 0,
      zoom: 16,
    }, { duration: 280 });
  }, [scene]);

  return (
    <View style={[styles.wrap, { backgroundColor: scene.night ? "#0e1620" : "#e7eef2" }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        userInterfaceStyle={scene.night ? "dark" : "light"}
        customMapStyle={Platform.OS === "android" ? (scene.night ? DARK_MAP_STYLE : []) : undefined}
        showsUserLocation
        followsUserLocation={scene.camera === "follow" && !scene.headingUp}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled
        pitchEnabled={false}
        onPanDrag={() => {
          held.current = true;
          onPan?.();
        }}
        mapPadding={{ top: 108, right: 64, bottom: 120, left: 12 }}
        initialRegion={{
          latitude: user?.lat ?? 43.6532,
          longitude: user?.lon ?? -79.3832,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
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
        {scene.routes.map((route, index) => (
          <Polyline
            key={`route-${index}`}
            coordinates={route.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={route.active ? "#ffffff" : route.color}
            strokeWidth={route.active ? 12 : 5}
          />
        ))}
        {scene.routes.map((route, index) => route.active ? (
          <Polyline
            key={`route-core-${index}`}
            coordinates={route.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={route.color || "#4da3ff"}
            strokeWidth={7}
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
              <SignView sign={sign} />
            </Marker>
          );
        })}
        {user ? (
          <Marker
            coordinate={{ latitude: user.lat, longitude: user.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={false}
            rotation={scene.headingUp ? 0 : user.heading}
            zIndex={8}
          >
            <Puck />
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

function Puck() {
  return (
    <View style={styles.puck}>
      <View style={styles.arrow} />
      <View style={styles.dot} />
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
  puck: { width: 36, height: 36, alignItems: "center" },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 14,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#1a73e8",
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#1a73e8",
    borderWidth: 3,
    borderColor: "#fff",
    marginTop: -4,
  },
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
