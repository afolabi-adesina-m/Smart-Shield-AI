/** Driver performance. Not the road safety score. Decision 2026-10-23. */

import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { historyBits, scoreLines } from "./format";
import type { TripSummary } from "./recorder";

export function DriverPerformance(props: {
  night?: boolean;
  recording: boolean;
  enabled: boolean;
  trips: TripSummary[];
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onToggle: () => void;
  onOpen: (trip: TripSummary) => void;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  const ink = props.night ? "#f2f2f7" : "#16191f";
  const last = props.trips[0];
  const lastLines = last ? scoreLines(last) : null;
  const ask = () => {
    Alert.alert("Clear history?", "This removes saved driver performance trips from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: props.onClear },
    ]);
  };
  return (
    <View style={styles.layer}>
      <Pressable style={styles.backdrop} onPress={props.onClose} />
      <View style={[styles.card, props.night && styles.cardNight, { marginBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: ink }]}>Driver performance</Text>
          <Pressable onPress={props.onClose} testID="driver-close">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>
          This is not the road safety score. That score rates the route. This one rates how the trip was driven.
        </Text>
        <Pressable
          testID={props.recording ? "driver-end" : "driver-start"}
          style={[styles.action, props.recording && styles.actionEnd]}
          onPress={props.recording ? props.onEnd : props.onStart}
        >
          <Text style={styles.actionText}>{props.recording ? "End trip" : "Start trip"}</Text>
        </Pressable>
        <Text style={styles.note}>
          Recording continues while Smart-Shield stays open. Expo Go does not keep GPS or motion running if you switch to Google Maps.
        </Text>
        <Text style={[styles.kicker, { color: ink }]}>Last trip</Text>
        {last && lastLines ? (
          <Pressable testID="driver-last" onPress={() => props.onOpen(last)}>
            <Text style={[styles.tripScore, { color: ink }]}>{lastLines.score} {lastLines.band}</Text>
            <Text style={styles.note}>{historyBits(last).when} · {lastLines.meta}</Text>
          </Pressable>
        ) : <Text style={styles.note}>No trips yet</Text>}
        <Text style={[styles.kicker, { color: ink }]}>Trip history</Text>
        <ScrollView style={styles.list}>
          {props.trips.map((trip, index) => {
            const bits = historyBits(trip);
            return (
              <Pressable key={`${trip.date}-${index}`} testID={`driver-trip-${index}`} style={styles.row} onPress={() => props.onOpen(trip)}>
                <Text style={[styles.when, { color: ink }]}>{bits.when}</Text>
                <Text style={styles.note}>{bits.distance} · {bits.score} {bits.band}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable testID="driver-clear" onPress={ask}>
          <Text style={styles.clear}>Clear history</Text>
        </Pressable>
        <Pressable testID="driver-enabled" onPress={props.onToggle}>
          <Text style={styles.done}>{props.enabled ? "Driver performance on" : "Driver performance off"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", zIndex: 30 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  card: {
    marginHorizontal: 12,
    maxHeight: "78%",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.98)",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 8,
  },
  cardNight: { backgroundColor: "rgba(28,28,30,0.96)" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700" },
  done: { color: "#1a73e8", fontWeight: "700", fontSize: 16 },
  note: { color: "#526072", fontSize: 13, lineHeight: 18 },
  action: { backgroundColor: "#1a73e8", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center" },
  actionEnd: { backgroundColor: "#d93025" },
  actionText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  kicker: { fontSize: 13, fontWeight: "700" },
  tripScore: { fontSize: 28, fontWeight: "700" },
  list: { maxHeight: 160 },
  row: { paddingVertical: 8 },
  when: { fontSize: 15, fontWeight: "700" },
  clear: { color: "#d93025", fontWeight: "700" },
});
