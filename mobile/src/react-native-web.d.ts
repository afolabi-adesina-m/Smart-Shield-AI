declare module "react-native-web" {
  import type { ReactElement } from "react";

  export function unstable_createElement(
    type: string,
    props: Record<string, unknown>,
  ): ReactElement;
}
