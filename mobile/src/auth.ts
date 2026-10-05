import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { API_BASE } from "./config";

// TODO: move this token to expo-secure-store when that package is added.
// AsyncStorage can be read on a rooted device and may be included in backups.
// It is enough for this MVP while AUTH_REQUIRED stays off by default.
const TOKEN_KEY = "smartshield.authToken.v1";

type Session = {
  ready: boolean;
  required: boolean;
  authed: boolean;
};

let token = "";
let session: Session = { ready: false, required: false, authed: false };
const listeners = new Set<(next: Session) => void>();

function emit() {
  listeners.forEach((listener) => listener(session));
}

export function getAuthToken(): string {
  return token;
}

export function useAuthSession(): Session {
  const [snap, setSnap] = useState(session);
  useEffect(() => {
    listeners.add(setSnap);
    setSnap(session);
    return () => { listeners.delete(setSnap); };
  }, []);
  return snap;
}

export async function noteUnauthorized(): Promise<void> {
  if (!session.required) return;
  token = "";
  session = { ...session, authed: false };
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  emit();
}

export async function refreshAuth(): Promise<void> {
  let required = false;
  try {
    const response = await fetch(`${API_BASE}/api/auth/status`, { headers: { Accept: "application/json" } });
    const data = await response.json() as { auth_required?: boolean };
    required = Boolean(data.auth_required);
  } catch {
    session = { ready: true, required: false, authed: false };
    emit();
    return;
  }
  if (!required) {
    token = "";
    session = { ready: true, required: false, authed: false };
    emit();
    return;
  }
  const saved = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  token = saved || "";
  if (!token) {
    session = { ready: true, required: true, authed: false };
    emit();
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/auth/status`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    const data = await response.json() as { authenticated?: boolean };
    if (!data.authenticated) token = "";
  } catch {
    /* Keep the saved token and try the next API call. */
  }
  session = { ready: true, required: true, authed: Boolean(token) };
  emit();
}

export async function signIn(username: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({})) as { error?: string; token?: string };
  if (!response.ok || !data.token) {
    throw new Error(data.error || "Sign in failed.");
  }
  token = data.token;
  await AsyncStorage.setItem(TOKEN_KEY, token);
  session = { ready: true, required: true, authed: true };
  emit();
  return token;
}

export async function signOut(): Promise<void> {
  token = "";
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  session = { ...session, authed: false, required: session.required };
  emit();
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
  } catch {
    /* The token is already gone on this phone. */
  }
}
