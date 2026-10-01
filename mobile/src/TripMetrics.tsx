import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

/** Clock, duration, and distance on one line so they share a baseline. */
export function TripMetrics(props: {
  arrival?: string;
  minutes?: string;
  distance?: string;
  unit?: string;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  const minutes = props.minutes || "—";
  const minuteTail = minutes === "Now" ? "" : " min";
  const line = `${props.arrival || "—"}\u2003${minutes}${minuteTail}\u2003${props.distance || "—"}\u00a0${props.unit || "km"}`;
  return (
    <View style={styles.box}>
      <Text
        testID="trip-metrics"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        allowFontScaling={false}
        style={[styles.line, { color: props.color }, props.style]}
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, minWidth: 0, justifyContent: "center" },
  line: {
    width: "100%",
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
    fontVariant: ["tabular-nums"],
  },
});
