import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cellKey,
  overpassQuery,
  spotsFromOverpass,
  type DeliveryOrder,
  type PickupSpot,
} from "./deliveryLogic";

const ORDER_KEY = "smartshield.deliveryOrders.v1";
const POI_KEY = "smartshield.deliveryPois.v1";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const memory = new Map<string, { at: number; spots: PickupSpot[] }>();

type PoiCache = { cells?: Record<string, { at: number; spots: PickupSpot[] }> };

export async function loadOrders(): Promise<DeliveryOrder[]> {
  try {
    const raw = await AsyncStorage.getItem(ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) as DeliveryOrder[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOrders(orders: DeliveryOrder[]): Promise<void> {
  await AsyncStorage.setItem(ORDER_KEY, JSON.stringify(orders.slice(0, 400)));
}

async function readPoiCache(): Promise<PoiCache> {
  try {
    const raw = await AsyncStorage.getItem(POI_KEY);
    return raw ? JSON.parse(raw) as PoiCache : {};
  } catch {
    return {};
  }
}

export async function loadSpots(lat: number, lon: number): Promise<PickupSpot[]> {
  const key = cellKey(lat, lon);
  const remembered = memory.get(key);
  if (remembered && Date.now() - remembered.at < 6 * 60 * 60 * 1000) return remembered.spots;
  const saved = await readPoiCache();
  const cell = saved.cells?.[key];
  if (cell && Date.now() - cell.at < 6 * 60 * 60 * 1000 && Array.isArray(cell.spots)) {
    memory.set(key, cell);
    return cell.spots;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: `data=${encodeURIComponent(overpassQuery(lat, lon))}`,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = await response.json() as { elements?: { lat?: number; lon?: number; tags?: Record<string, string> }[] };
    const spots = spotsFromOverpass(data.elements);
    memory.set(key, { at: Date.now(), spots });
    const cells = { ...(saved.cells || {}), [key]: { at: Date.now(), spots } };
    const keys = Object.keys(cells).slice(-8);
    const trimmed: PoiCache["cells"] = {};
    keys.forEach((name) => { trimmed[name] = cells[name]; });
    await AsyncStorage.setItem(POI_KEY, JSON.stringify({ cells: trimmed }));
    return spots;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
