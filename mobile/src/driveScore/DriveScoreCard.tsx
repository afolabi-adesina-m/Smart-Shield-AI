/** Spec §4 and §5. End-of-trip card, history list, and clear button. */

import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bandColor, historyBits, scoreLines, type ScoreTrip } from "./format";

type CardTrip = ScoreTrip;

function Sheet(props: { night?: boolean; title: string; onClose: () => void; testID: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const ink = props.night ? "#f2f2f7" : "#16191f";
  return (
    <View style={styles.layer}>
      <Pressable style={styles.backdrop} onPress={props.onClose} />
      <View style={[styles.card, props.night && styles.cardNight, { marginBottom: insets.bottom + 12 }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: ink }]}>{props.title}</Text>
          <Pressable onPress={props.onClose} testID={props.testID}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        {props.children}
      </View>
    </View>
  );
}

function Row(props: { icon: "warning-outline" | "swap-horizontal-outline" | "speedometer-outline"; label: string; points: string; detail: string; night?: boolean }) {
  const ink = props.night ? "#f2f2f7" : "#16191f";
  return (
    <View style={styles.row}>
      <Ionicons name={props.icon} size={22} color="#1a73e8" />
      <View style={styles.rowBody}>
        <Text style={[styles.label, { color: ink }]}>{props.label}</Text>
        <Text style={styles.detail}>{props.detail}</Text>
      </View>
      <Text style={[styles.points, { color: ink }]}>{props.points}</Text>
    </View>
  );
}

export function DriveScoreCard(props: { trip: CardTrip; night?: boolean; onClose: () => void }) {
  const lines = scoreLines(props.trip);
  const ink = props.night ? "#f2f2f7" : "#16191f";
  return (
    <Sheet night={props.night} title="Drive Score" onClose={props.onClose} testID="drive-score-close">
      <Text style={[styles.score, { color: ink }]} accessibilityLabel={`Drive score ${lines.score} ${lines.band}`}>
        {lines.score}
      </Text>
      <Text style={[styles.band, { color: bandColor(props.trip.band) }]}>{lines.band}</Text>
      <Text style={styles.detail}>{lines.meta}</Text>
      <Row icon="warning-outline" label="Braking" points={lines.brake.points} detail={lines.brake.detail} night={props.night} />
      <Row icon="swap-horizontal-outline" label="Turns" points={lines.turn.points} detail={lines.turn.detail} night={props.night} />
      <Row icon="speedometer-outline" label="Speeding" points={lines.speed.points} detail={lines.speed.detail} night={props.night} />
      <Text style={styles.info}>{lines.lights}</Text>
    </Sheet>
  );
}

export function TripHistory<T extends CardTrip>(props: {
  trips: T[];
  night?: boolean;
  onClose: () => void;
  onOpen: (trip: T) => void;
  onClear: () => void;
}) {
  const ask = () => {
    Alert.alert("Clear history?", "This removes saved trip scores from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: props.onClear },
    ]);
  };
  const ink = props.night ? "#f2f2f7" : "#16191f";
  return (
    <Sheet night={props.night} title="Trips" onClose={props.onClose} testID="history-close">
      <ScrollView style={styles.list}>
        {props.trips.length ? props.trips.map((trip, index) => {
          const bits = historyBits(trip);
          return (
            <Pressable key={`${trip.date}-${index}`} style={styles.historyRow} testID={`trip-${index}`} onPress={() => props.onOpen(trip)}>
              <View style={styles.rowBody}>
                <Text style={[styles.label, { color: ink }]}>{bits.when}</Text>
                <Text style={styles.detail}>{bits.distance}</Text>
              </View>
              <View style={styles.scoreCol}>
                <Text style={[styles.points, { color: ink }]}>{bits.score}</Text>
                <Text style={[styles.detail, { color: bandColor(trip.band) }]}>{bits.band}</Text>
              </View>
            </Pressable>
          );
        }) : <Text style={styles.detail}>No trips yet</Text>}
      </ScrollView>
      <Pressable onPress={ask} testID="clear-history">
        <Text style={styles.clear}>Clear history</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", zIndex: 40 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  card: {
    marginHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.98)",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 6,
  },
  cardNight: { backgroundColor: "rgba(28,28,30,0.96)" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 16, fontWeight: "700" },
  done: { color: "#1a73e8", fontWeight: "700", fontSize: 16 },
  score: { fontSize: 64, fontWeight: "700", lineHeight: 72, textAlign: "center" },
  band: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rowBody: { flex: 1 },
  label: { fontSize: 16, fontWeight: "700" },
  detail: { color: "#526072", fontSize: 13 },
  points: { fontSize: 18, fontWeight: "700" },
  info: { color: "#526072", fontSize: 13, paddingTop: 4 },
  list: { maxHeight: 360 },
  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 },
  scoreCol: { alignItems: "flex-end" },
  clear: { color: "#d93025", fontWeight: "700", paddingTop: 8 },
});
