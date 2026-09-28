import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { unstable_createElement as createHost } from "react-native-web";
import type { MapScene } from "./types";
import { MAP_HTML } from "./mapHtml";

type Props = {
  scene: MapScene;
};

type Frame = {
  contentWindow?: { applyScene?: (scene: MapScene) => void };
};

/** The computer preview uses an iframe. Phones use MapCanvas.tsx instead. */
export function MapCanvas({ scene }: Props) {
  const frameRef = useRef<Frame | null>(null);
  const latest = useRef(scene);
  latest.current = scene;

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
          backgroundColor: "#0e1620",
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, position: "relative", backgroundColor: "#0e1620" },
});
