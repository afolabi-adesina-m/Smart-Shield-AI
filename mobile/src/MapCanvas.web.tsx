import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { unstable_createElement as createHost } from "react-native-web";
import type { MapScene } from "./types";
import { MAP_HTML } from "./mapHtml";

type Props = {
  scene: MapScene;
  onRoutePoint?: (lat: number, lon: number) => void;
  onPan?: () => void;
};

type Frame = {
  contentWindow?: { applyScene?: (scene: MapScene) => void };
};

/** The computer preview uses OpenStreetMap in an iframe. Phones use the native map. */
export function MapCanvas({ scene, onRoutePoint, onPan }: Props) {
  const frameRef = useRef<Frame | null>(null);
  const latest = useRef(scene);
  latest.current = scene;
  const pointRef = useRef(onRoutePoint);
  pointRef.current = onRoutePoint;
  const panRef = useRef(onPan);
  panRef.current = onPan;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; lat?: number; lon?: number } | null;
      if (!data) return;
      if (data.type === "smartshield-map-pan") {
        panRef.current?.();
        return;
      }
      if (data.type !== "smartshield-route-press") return;
      if (typeof data.lat !== "number" || typeof data.lon !== "number") return;
      pointRef.current?.(data.lat, data.lon);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function push(next: MapScene) {
    frameRef.current?.contentWindow?.applyScene?.(next);
  }

  useEffect(() => {
    push(scene);
  }, [scene]);

  return (
    <View style={styles.wrap}>
      {createHost("iframe", {
        ref: frameRef,
        title: "Smart-Shield map",
        srcDoc: MAP_HTML,
        onLoad: () => push(latest.current),
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          border: "0",
          backgroundColor: scene.night ? "#0e1620" : "#d5dde6",
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, position: "relative", backgroundColor: "#d5dde6" },
});
