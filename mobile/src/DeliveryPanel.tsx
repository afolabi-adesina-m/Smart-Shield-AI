import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import {
  DELIVERY_APPS,
  ESTIMATE_LABEL,
  heatSpots,
  ordersToCsv,
  summarize,
  weightCaption,
  type DeliveryAppId,
  type DeliveryOrder,
  type HeatSpot,
  type PickupSpot,
} from "./deliveryLogic";
import { loadOrders, loadSpots, saveOrders } from "./deliveryStore";
import type { StoredTrip } from "./fleetStore";

type Props = {
  lat: number;
  lon: number;
  trips: StoredTrip[];
  recording: boolean;
  onHeat: (spots: HeatSpot[], estimateOn: boolean) => void;
};

export function DeliveryPanel(props: Props) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [spots, setSpots] = useState<PickupSpot[]>([]);
  const [spotNote, setSpotNote] = useState("Looking for pickup spots…");
  const [app, setApp] = useState<DeliveryAppId>("doordash");
  const [pay, setPay] = useState("");
  const [tip, setTip] = useState("");
  const [miles, setMiles] = useState("");
  const [fleetId, setFleetId] = useState("");
  const [showEstimate, setShowEstimate] = useState(true);
  const [showOrders, setShowOrders] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    loadOrders().then(setOrders).catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSpots(props.lat, props.lon).then((next) => {
      if (cancelled) return;
      setSpots(next);
      setSpotNote(next.length
        ? `${next.length} pickup spots nearby. ${weightCaption(new Date())}`
        : "Pickup spots did not load. The estimate appears when OpenStreetMap answers.");
    }).catch(() => {
      if (!cancelled) setSpotNote("Pickup spots did not load. The estimate appears when OpenStreetMap answers.");
    });
    return () => { cancelled = true; };
  }, [props.lat, props.lon]);

  const onHeatRef = useRef(props.onHeat);
  onHeatRef.current = props.onHeat;
  useEffect(() => {
    onHeatRef.current(heatSpots(spots, orders, new Date(), showEstimate, showOrders), showEstimate);
  }, [spots, orders, showEstimate, showOrders]);

  const summary = summarize(orders);
  const when = new Date().toLocaleString();

  async function logOrder() {
    const amount = Number(pay);
    if (!Number.isFinite(amount) || amount < 0) {
      setSaved("Enter the pay.");
      return;
    }
    const tipValue = tip.trim() === "" ? null : Number(tip);
    const mileValue = miles.trim() === "" ? null : Number(miles);
    const order: DeliveryOrder = {
      id: new Date().toISOString(),
      app,
      pay: amount,
      tip: tipValue != null && Number.isFinite(tipValue) ? tipValue : null,
      miles: mileValue != null && Number.isFinite(mileValue) ? mileValue : null,
      at: new Date().toISOString(),
      lat: props.lat,
      lon: props.lon,
      fleetTripId: fleetId || null,
    };
    const next = [order, ...orders].slice(0, 400);
    setOrders(next);
    setPay("");
    setTip("");
    setMiles("");
    setSaved("Saved on this device.");
    setShowOrders(true);
    try {
      await saveOrders(next);
    } catch {
      setSaved("Saved for this session. This device could not keep the file.");
    }
  }

  async function exportCsv() {
    const csv = ordersToCsv(orders);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "smart-shield-delivery.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setSaved("CSV downloaded.");
      return;
    }
    try {
      await Share.share({ message: csv, title: "smart-shield-delivery.csv" });
      setSaved("CSV ready to share.");
    } catch {
      setSaved("Could not open the share sheet.");
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.estimate} testID="delivery-estimate">{ESTIMATE_LABEL}</Text>
      <Text style={styles.note}>{weightCaption(new Date())}</Text>
      <View style={styles.row}>
        <Pressable
          testID="delivery-heat"
          style={[styles.chip, showEstimate && styles.chipOn]}
          onPress={() => setShowEstimate((value) => !value)}
        >
          <Text style={[styles.chipText, showEstimate && styles.chipTextOn]}>Pickup estimate</Text>
        </Pressable>
        <Pressable
          testID="delivery-orders"
          style={[styles.chip, showOrders && styles.chipOn]}
          onPress={() => setShowOrders((value) => !value)}
        >
          <Text style={[styles.chipText, showOrders && styles.chipTextOn]}>My orders</Text>
        </Pressable>
      </View>
      <Text style={styles.note} testID="delivery-spot-note">{spotNote}</Text>
      <Text style={styles.kicker}>Log order</Text>
      <View style={styles.row}>
        {DELIVERY_APPS.map((item) => (
          <Pressable
            key={item.id}
            testID={`delivery-app-${item.id}`}
            style={[styles.chip, app === item.id && styles.chipOn]}
            onPress={() => setApp(item.id)}
          >
            <Text style={[styles.chipText, app === item.id && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Pay $</Text>
      <TextInput testID="delivery-pay" value={pay} onChangeText={setPay} keyboardType="decimal-pad" style={styles.input} />
      <Text style={styles.label}>Tip $ optional</Text>
      <TextInput testID="delivery-tip" value={tip} onChangeText={setTip} keyboardType="decimal-pad" style={styles.input} />
      <Text style={styles.label}>Miles optional</Text>
      <TextInput testID="delivery-miles" value={miles} onChangeText={setMiles} keyboardType="decimal-pad" style={styles.input} />
      <Text style={styles.note} testID="delivery-place">
        {`Pickup ${props.lat.toFixed(5)}, ${props.lon.toFixed(5)} · ${when}`}
      </Text>
      <Text style={styles.label}>Fleet trip</Text>
      <View style={styles.row}>
        <Pressable testID="delivery-fleet-none" style={[styles.chip, fleetId === "" && styles.chipOn]} onPress={() => setFleetId("")}>
          <Text style={[styles.chipText, fleetId === "" && styles.chipTextOn]}>None</Text>
        </Pressable>
        {props.recording ? (
          <Pressable testID="delivery-fleet-live" style={[styles.chip, fleetId === "recording" && styles.chipOn]} onPress={() => setFleetId("recording")}>
            <Text style={[styles.chipText, fleetId === "recording" && styles.chipTextOn]}>Recording now</Text>
          </Pressable>
        ) : null}
        {props.trips.slice(0, 4).map((trip) => (
          <Pressable key={trip.id} style={[styles.chip, fleetId === trip.id && styles.chipOn]} onPress={() => setFleetId(trip.id)}>
            <Text style={[styles.chipText, fleetId === trip.id && styles.chipTextOn]}>{trip.title}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable testID="delivery-log" style={styles.primary} onPress={() => { logOrder().catch(() => setSaved("Could not save the order.")); }}>
        <Text style={styles.primaryText}>Log order</Text>
      </Pressable>
      {saved ? <Text style={styles.saved} testID="delivery-saved">{saved}</Text> : null}
      <Text style={styles.kicker}>Your summary</Text>
      <View testID="delivery-summary">
        {orders.length === 0 ? (
          <Text style={styles.note}>Log an order to see your hours and areas. This is your own list, not app demand.</Text>
        ) : (
          <>
            <Text style={styles.note}>Dollars per hour counts each clock hour once when it has a logged order. Tips are included. This is your own log, not live app demand.</Text>
            <Text style={styles.block}>Best hours</Text>
            {summary.bestHours.map((row) => (
              <Text key={`h-${row.key}`} style={styles.line}>{`${row.label} · $${row.perHour.toFixed(2)}/hour`}</Text>
            ))}
            <Text style={styles.block}>Best areas</Text>
            {summary.bestAreas.map((row) => (
              <Text key={row.label} style={styles.line}>{`${row.label} · $${row.pay.toFixed(2)} · $${row.perHour.toFixed(2)}/hour`}</Text>
            ))}
            <Text style={styles.block}>Per app</Text>
            {summary.byApp.map((row) => (
              <Text key={row.key} style={styles.line}>{`${row.label} · $${row.perHour.toFixed(2)}/hour · $${row.pay.toFixed(2)} · ${row.orders} orders`}</Text>
            ))}
            <Text style={styles.block}>Per weekday</Text>
            {summary.byWeekday.map((row) => (
              <Text key={row.key} style={styles.line}>{`${row.label} · $${row.perHour.toFixed(2)}/hour`}</Text>
            ))}
            <Text style={styles.block}>Per hour</Text>
            {summary.byHour.map((row) => (
              <Text key={`hour-${row.key}`} style={styles.line}>{`${row.label} · $${row.perHour.toFixed(2)}/hour · ${row.orders} orders`}</Text>
            ))}
          </>
        )}
      </View>
      <Pressable testID="delivery-export" style={styles.secondary} onPress={() => { exportCsv().catch(() => setSaved("Could not export.")); }}>
        <Text style={styles.secondaryText}>Export CSV</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  estimate: {
    backgroundColor: "#e5f6f2",
    color: "#0d3d36",
    fontWeight: "700",
    borderRadius: 12,
    padding: 10,
    lineHeight: 18,
  },
  note: { color: "#526072", fontSize: 13, lineHeight: 18 },
  kicker: { fontSize: 12, fontWeight: "700", color: "#526072", marginTop: 6 },
  label: { fontSize: 13, fontWeight: "700", color: "#16191f" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#eef2f7" },
  chipOn: { backgroundColor: "#14685c" },
  chipText: { color: "#16191f", fontWeight: "600" },
  chipTextOn: { color: "#ffffff" },
  input: {
    borderWidth: 1,
    borderColor: "rgba(22,25,31,0.12)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#16191f",
    backgroundColor: "#fff",
  },
  primary: { backgroundColor: "#14685c", borderRadius: 14, minHeight: 46, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondary: { backgroundColor: "#1a56db", borderRadius: 12, minHeight: 42, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#fff", fontWeight: "700" },
  saved: { color: "#14685c", fontWeight: "700" },
  block: { marginTop: 8, fontWeight: "700", color: "#16191f" },
  line: { color: "#16191f", fontSize: 14, paddingVertical: 1 },
});
