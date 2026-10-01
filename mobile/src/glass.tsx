import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

type Props = {
  night: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  intensity?: number;
  testID?: string;
};

/** Frosted surface. iOS uses the system blur; other platforms use a translucent fill. */
export function Glass(props: Props) {
  const tint = props.night ? "dark" : "light";
  if (Platform.OS === "web") {
    return (
    <View testID={props.testID} style={[props.night ? styles.webNight : styles.webDay, props.style]}>
      {props.children}
    </View>
    );
  }
  return (
    <BlurView
      intensity={props.intensity ?? 48}
      tint={tint}
      experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
      testID={props.testID}
      style={props.style}
    >
      {props.children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  webDay: { backgroundColor: "rgba(255,255,255,0.86)" },
  webNight: { backgroundColor: "rgba(28,28,30,0.82)" },
});
