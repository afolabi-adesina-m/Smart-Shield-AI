export type Place = {
  id?: string;
  label: string;
  detail?: string;
  lat: number | null;
  lon: number | null;
};

export type Suggestion = {
  id: string;
  label: string;
  detail: string;
  lat: number | null;
  lon: number | null;
};

export type RoadStep = {
  name: string;
  distance: number;
  location: [number, number] | null;
  geometry: [number, number][];
  type: string;
  modifier: string;
  instruction: string;
};

export type OsrmRoute = {
  distance: number;
  duration: number;
  summary: string;
  geometry: [number, number][];
  mid_lat: number | null;
  mid_lon: number | null;
  steps?: RoadStep[];
};

export type StageA = {
  p_fatal?: number;
  flagged?: boolean;
  threshold?: number;
  model_name?: string;
} | null;

export type ScoredRoute = {
  route_index: number;
  summary?: string;
  safety_score: number | null;
  safety_rank?: number;
  tier?: string;
  tier_color?: string;
  operational_message?: string;
  recommended_speed_kmh?: number | null;
  duration_text?: string;
  distance_km?: number;
  collision_risk_index?: number | null;
  collision_risk_calibrated?: boolean;
  stage_a_fatal?: StageA;
  alert_preview?: string;
  alert_source?: string;
  e_index_source?: string;
  vision_source?: string;
  weather_preset?: string;
};

export type SpeedReading = {
  posted_kmh?: number;
  safe_kmh?: number;
  road_name?: string | null;
  highway?: string | null;
  estimated?: boolean;
  summary?: string;
  detail?: string;
  road_mode?: string;
  lookup_ok?: boolean;
  school_active?: boolean;
  exit_warning?: { text?: string } | null;
  hazards?: {
    id: string;
    kind: string;
    label?: string;
    lat?: number;
    lon?: number;
    distance_m?: number;
  }[];
};

export type TestCentre = {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  coords_approximate?: boolean;
};

export type PracticePoint = {
  kind: string;
  label: string;
  lat: number;
  lon: number;
  scored?: boolean;
};

export type PracticeLoop = {
  centre: TestCentre;
  level: string;
  geometry: [number, number][];
  distance_m: number;
  duration_s: number;
  points: PracticePoint[];
  overpass_note?: string;
  disclaimer?: string;
};

export type Health = {
  status?: string;
  edition?: string;
  engine?: { mode?: string; locked?: boolean; message?: string };
  models_present?: boolean;
};

export type MapRoute = {
  coords: [number, number][];
  color: string;
  active: boolean;
};

export type MapMarker = {
  lat: number;
  lon: number;
  label: string;
  color: string;
};

export type MapSign = {
  lat: number;
  lon: number;
  kind: "signal" | "stop" | "stop-all" | "report" | "red_light" | "speed_camera" | "variable";
  label?: string;
  subtle?: boolean;
};

export type MapHeat = {
  lat: number;
  lon: number;
  weight: number;
  kind: "estimate" | "order";
};

export type MapPreview = {
  name: string;
  coords: [number, number][];
  lat: number;
  lon: number;
};

export type MapStep = {
  name: string;
  coords: [number, number][];
  lat: number;
  lon: number;
};

export type MapScene = {
  routes: MapRoute[];
  markers: MapMarker[];
  signs: MapSign[];
  heat: MapHeat[];
  user: { lat: number; lon: number; heading: number } | null;
  camera: "follow" | "fit";
  followToken?: number;
  headingUp: boolean;
  night: boolean;
  steps: MapStep[];
  preview: MapPreview | null;
};
