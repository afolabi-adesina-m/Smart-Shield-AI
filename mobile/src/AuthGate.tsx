import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { signIn, useAuthSession } from "./auth";

/** Shown only when the server has AUTH_REQUIRED on and this phone has no token. */
export function AuthGate() {
  const session = useAuthSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session.ready || !session.required || session.authed) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.gate}>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.copy}>This server is asking for the demo admin account.</Text>
        <Text style={styles.label}>Username</Text>
        <TextInput
          testID="auth-user"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          testID="auth-pass"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} disabled={busy} onPress={() => { submit().catch(() => undefined); }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 80,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  title: { fontSize: 18, fontWeight: "700", color: "#16191f" },
  copy: { color: "#526072", fontSize: 14, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#16191f" },
  input: {
    borderWidth: 1,
    borderColor: "#d5dde6",
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    fontSize: 16,
  },
  error: { color: "#b42318", fontSize: 13 },
  button: {
    marginTop: 8,
    backgroundColor: "#1a56db",
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
