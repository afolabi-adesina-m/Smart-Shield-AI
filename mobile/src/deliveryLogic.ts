/** On-device delivery planner. Pickup weights are an estimate from map spots, never live app demand. */

export const ESTIMATE_LABEL = "Estimate based on nearby pickup spots, not live app demand";

export const DELIVERY_APPS = [
  { id: "doordash", label: "DoorDash" },
  { id: "uber", label: "Uber Eats" },
  { id: "spark", label: "Spark" },
  { id: "instacart", label: "Instacart" },
  { id: "skip", label: "Skip" },
  { id: "other", label: "Other" },
] as const;

export type DeliveryAppId = (typeof DELIVERY_APPS)[number]["id"];

export type DeliveryOrder = {
  id: string;
  app: DeliveryAppId;
  pay: number;
  tip: number | null;
  miles: number | null;
  at: string;
  lat: number;
  lon: number;
  fleetTripId: string | null;
};

export type PickupKind = "food" | "grocery";

export type PickupSpot = {
  lat: number;
  lon: number;
  kind: PickupKind;
};

export type HeatSpot = {
  lat: number;
  lon: number;
  weight: number;
  kind: "estimate" | "order";
};

export type RateRow = {
  key: string;
  label: string;
  orders: number;
  pay: number;
  hours: number;
  perHour: number;
};

export type AreaRow = {
  label: string;
  lat: number;
  lon: number;
  orders: number;
  pay: number;
  hours: number;
  perHour: number;
};

export type DeliverySummary = {
  byApp: RateRow[];
  byWeekday: RateRow[];
  byHour: RateRow[];
  bestHours: RateRow[];
  bestAreas: AreaRow[];
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function appLabel(id: string): string {
  return DELIVERY_APPS.find((item) => item.id === id)?.label || "Other";
}

export function mealWindow(date: Date): "lunch" | "dinner" | "other" {
  const hour = date.getHours();
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "other";
}

export function poiWeight(kind: PickupKind, date: Date): number {
  const meal = mealWindow(date) !== "other";
  if (kind === "food") return meal ? 1.8 : 0.45;
  return meal ? 0.5 : 1.7;
}

export function weightCaption(date: Date): string {
  const meal = mealWindow(date);
  if (meal === "lunch") return "Lunch hours (11–14): restaurants, fast food, and cafes count more.";
  if (meal === "dinner") return "Dinner hours (17–21): restaurants, fast food, and cafes count more.";
  return "Outside lunch and dinner: grocery and pharmacy spots count more.";
}

export function orderPay(order: DeliveryOrder): number {
  const tip = order.tip == null || Number.isNaN(order.tip) ? 0 : order.tip;
  return Math.round((Number(order.pay) + tip) * 100) / 100;
}

export function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function cellCenter(lat: number, lon: number): { lat: number; lon: number } {
  const row = Math.round(lat / 0.0045);
  const col = Math.round(lon / 0.006);
  return { lat: row * 0.0045, lon: col * 0.006 };
}

function areaKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function heatSpots(
  spots: PickupSpot[],
  orders: DeliveryOrder[],
  date: Date,
  showEstimate: boolean,
  showOrders: boolean,
): HeatSpot[] {
  const estimate = new Map<string, HeatSpot>();
  if (showEstimate) {
    spots.forEach((spot) => {
      const center = cellCenter(spot.lat, spot.lon);
      const key = `${center.lat.toFixed(4)},${center.lon.toFixed(4)}`;
      const weight = poiWeight(spot.kind, date);
      const prev = estimate.get(key);
      if (prev) prev.weight += weight;
      else estimate.set(key, { lat: center.lat, lon: center.lon, weight, kind: "estimate" });
    });
  }
  const mine = new Map<string, HeatSpot>();
  if (showOrders) {
    orders.forEach((order) => {
      const center = cellCenter(order.lat, order.lon);
      const key = `${center.lat.toFixed(4)},${center.lon.toFixed(4)}`;
      const weight = Math.max(0.4, orderPay(order) / 15);
      const prev = mine.get(key);
      if (prev) prev.weight += weight;
      else mine.set(key, { lat: center.lat, lon: center.lon, weight, kind: "order" });
    });
  }
  return [...normalize(estimate), ...normalize(mine)].sort((a, b) => b.weight - a.weight).slice(0, 80);
}

function normalize(cells: Map<string, HeatSpot>): HeatSpot[] {
  const list = [...cells.values()];
  const max = Math.max(1, ...list.map((cell) => cell.weight));
  return list.map((cell) => ({ ...cell, weight: cell.weight / max }));
}

function hourKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 13);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}T${hour}`;
}

function rowsFor(groups: Map<string, DeliveryOrder[]>, labelFor: (key: string) => string): RateRow[] {
  return [...groups.entries()].map(([key, list]) => {
    const pay = Math.round(list.reduce((sum, order) => sum + orderPay(order), 0) * 100) / 100;
    const hours = new Set(list.map((order) => hourKey(order.at))).size || 1;
    return {
      key,
      label: labelFor(key),
      orders: list.length,
      pay,
      hours,
      perHour: Math.round((pay / hours) * 100) / 100,
    };
  }).sort((a, b) => b.perHour - a.perHour);
}

export function summarize(orders: DeliveryOrder[]): DeliverySummary {
  const byApp = new Map<string, DeliveryOrder[]>();
  const byWeekday = new Map<string, DeliveryOrder[]>();
  const byHour = new Map<string, DeliveryOrder[]>();
  const byArea = new Map<string, DeliveryOrder[]>();
  orders.forEach((order) => {
    const when = new Date(order.at);
    const weekday = Number.isNaN(when.getTime()) ? "0" : String(when.getDay());
    const hour = Number.isNaN(when.getTime()) ? "0" : String(when.getHours());
    pushGroup(byApp, order.app, order);
    pushGroup(byWeekday, weekday, order);
    pushGroup(byHour, hour, order);
    pushGroup(byArea, areaKey(order.lat, order.lon), order);
  });
  const hours = rowsFor(byHour, (key) => `${key.padStart(2, "0")}:00`);
  const areas: AreaRow[] = [...byArea.entries()].map(([key, list]) => {
    const [lat, lon] = key.split(",").map(Number);
    const pay = Math.round(list.reduce((sum, order) => sum + orderPay(order), 0) * 100) / 100;
    const worked = new Set(list.map((order) => hourKey(order.at))).size || 1;
    return {
      label: `Near ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      lat,
      lon,
      orders: list.length,
      pay,
      hours: worked,
      perHour: Math.round((pay / hoursOf(worked)) * 100) / 100,
    };
  }).sort((a, b) => b.pay - a.pay);
  return {
    byApp: rowsFor(byApp, appLabel),
    byWeekday: rowsFor(byWeekday, (key) => WEEKDAYS[Number(key)] || key).sort((a, b) => Number(a.key) - Number(b.key)),
    byHour: [...hours].sort((a, b) => Number(a.key) - Number(b.key)),
    bestHours: hours.slice(0, 3),
    bestAreas: areas.slice(0, 3),
  };
}

function hoursOf(value: number): number {
  return value || 1;
}

function pushGroup(groups: Map<string, DeliveryOrder[]>, key: string, order: DeliveryOrder): void {
  const list = groups.get(key);
  if (list) list.push(order);
  else groups.set(key, [order]);
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function ordersToCsv(orders: DeliveryOrder[]): string {
  const header = ["logged_at", "app", "pay", "tip", "miles", "lat", "lon", "fleet_trip_id"];
  const lines = [header.join(",")];
  orders.forEach((order) => {
    lines.push([
      order.at,
      order.app,
      order.pay,
      order.tip,
      order.miles,
      order.lat,
      order.lon,
      order.fleetTripId,
    ].map(csvCell).join(","));
  });
  return lines.join("\n");
}

export function classifyTags(tags: Record<string, string> | undefined): PickupKind | null {
  if (!tags) return null;
  const amenity = tags.amenity || "";
  if (amenity === "restaurant" || amenity === "fast_food" || amenity === "cafe") return "food";
  const shop = tags.shop || "";
  if (shop === "supermarket" || shop === "convenience" || shop === "chemist" || amenity === "pharmacy") return "grocery";
  const brand = `${tags.brand || ""} ${tags.name || ""}`.toLowerCase();
  if (/walmart|shoppers|loblaws|no frills|superstore|sobeys|rexall|costco|freshco|walgreens|\bcvs\b|\bmetro\b/.test(brand)) {
    return "grocery";
  }
  return null;
}

export function overpassQuery(lat: number, lon: number): string {
  const around = `around:1600,${lat},${lon}`;
  return `[out:json][timeout:18];(` +
    `node["amenity"="restaurant"](${around});` +
    `node["amenity"="fast_food"](${around});` +
    `node["amenity"="cafe"](${around});` +
    `node["shop"="supermarket"](${around});` +
    `node["shop"="convenience"](${around});` +
    `node["shop"="chemist"](${around});` +
    `node["amenity"="pharmacy"](${around});` +
    `node["brand"~"Walmart|Shoppers|Loblaws|No Frills|Superstore|Sobeys|Rexall|Costco|FreshCo",i](${around});` +
    `);out body 180;`;
}

export function spotsFromOverpass(elements: { lat?: number; lon?: number; tags?: Record<string, string> }[] | undefined): PickupSpot[] {
  const spots: PickupSpot[] = [];
  (elements || []).forEach((element) => {
    if (element.lat == null || element.lon == null) return;
    const kind = classifyTags(element.tags);
    if (!kind) return;
    spots.push({ lat: element.lat, lon: element.lon, kind });
  });
  return spots;
}
