import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchFleetDemoRoute, fetchStreetRules } from "./api";
import { FALLBACK_RULES, FLEET_LABELS } from "./fleetLogic";
import {
  getFleetSnapshot,
  loadFleetHistory,
  playSample,
  setStreetRules,
  startTrip,
  stopTrip,
  subscribeFleet,
} from "./fleetStore";

type Props = {
  speedMode: "gps" | "simulate";
};

export function FleetPanel({ speedMode }: Props) {
  const fleet = useSyncExternalStore(subscribeFleet, getFleetSnapshot, getFleetSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadFleetHistory();
      try {
        const rules = await fetchStreetRules();
        if (!cancelled && rules?.score?.penalties) setStreetRules(rules);
        else if (!cancelled) setStreetRules(FALLBACK_RULES);
      } catch {
        if (!cancelled) setStreetRules(FALLBACK_RULES);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const events = fleet.memory.events.slice().reverse();

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>Fleet trip</Text>
      <Text style={styles.lead}>
        Records speed against the posted limit and the safe speed. The score uses the same street and exit rules as the website. Trips stay on this phone.
      </Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.primary, fleet.running && styles.disabled]}
          disabled={!ready || fleet.running}
          onPress={() => startTrip(speedMode === "gps" ? "gps" : "simulate")}
        >
          <Text style={styles.primaryText}>Start trip</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryBtn, !fleet.running && styles.disabled]}
          disabled={!fleet.running}
          onPress={() => { stopTrip().catch(() => undefined); }}
        >
          <Text style={styles.secondaryText}>Stop</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.primary, (!ready || fleet.running) && styles.disabled]}
        disabled={!ready || fleet.running}
        onPress={() => {
          fetchFleetDemoRoute().then((route) => playSample(route || undefined));
        }}
      >
        {ready ? <Text style={styles.primaryText}>Play sample trip</Text> : <ActivityIndicator color="#fff" />}
      </Pressable>
      <View style={styles.scoreRow}>
        <Text style={[styles.score, fleet.score < 60 ? styles.poor : fleet.score < 85 ? styles.warn : styles.good]}>
          {fleet.score}
        </Text>
        <Text style={styles.scoreLabel}>Driver safety score</Text>
      </View>
      <Text style={styles.status}>{fleet.status}</Text>
      {events.length ? events.map((event, index) => (
        <View key={`${event.time_iso}-${event.kind}-${index}`} style={styles.event}>
          <Text style={styles.eventTitle}>{FLEET_LABELS[event.kind] || event.kind}</Text>
          <Text style={styles.note}>
            {event.detail}
            {event.duration_s != null ? ` · ${event.duration_s}s` : ""}
            {event.posted_kmh != null ? ` · limit ${event.posted_kmh}` : ""}
            {` · ${event.speed_kmh} km/h`}
          </Text>
          <Text style={styles.fine}>{event.lat.toFixed(5)}, {event.lon.toFixed(5)}</Text>
        </View>
      )) : <Text style={styles.note}>No safety events yet.</Text>}
      {fleet.trips.length ? <Text style={styles.kicker}>On this phone</Text> : null}
      {fleet.trips.slice(0, 5).map((trip) => (
        <Text key={trip.id} style={styles.note}>
          {trip.title} · score {trip.score} · {trip.events.length} events · {(trip.distance_m / 1000).toFixed(1)} km
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  kicker: { fontSize: 12, fontWeight: "700", color: "#526072" },
  lead: { color: "#526072", fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8 },
  primary: {
    flex: 1,
    backgroundColor: "#1a56db",
    borderRadius: 14,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    borderRadius: 14,
    minHeight: 46,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef2f7",
  },
  secondaryText: { color: "#16191f", fontWeight: "700" },
  disabled: { opacity: 0.55 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 },
  score: { fontSize: 36, fontWeight: "800" },
  scoreLabel: { color: "#526072", fontWeight: "600" },
  good: { color: "#0d7a45" },
  warn: { color: "#8a5a00" },
  poor: { color: "#b3261e" },
  status: { color: "#16191f", fontSize: 13, lineHeight: 18 },
  event: {
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  eventTitle: { fontWeight: "700", color: "#16191f" },
  note: { color: "#526072", fontSize: 13, lineHeight: 18 },
  fine: { color: "#8b97a6", fontSize: 11 },
});
