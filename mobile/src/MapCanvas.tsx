import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { MapScene } from "./types";
import { MAP_HTML } from "./mapHtml";

type Props = {
  scene: MapScene;
};

/** Expo Go draws the OpenStreetMap page inside a WebView. No map API key. */
export function MapCanvas({ scene }: Props) {
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef(scene);
  latest.current = scene;

  function push(next: MapScene) {
    const payload = JSON.stringify(next).replace(/</g, "\\u003c");
    webRef.current?.injectJavaScript(`window.applyScene && window.applyScene(${payload}); true;`);
  }

  useEffect(() => {
    if (ready.current) push(scene);
  }, [scene]);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: MAP_HTML }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onLoadEnd={() => {
          ready.current = true;
          push(latest.current);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#d5dde6" },
  web: { flex: 1, backgroundColor: "transparent" },
});
