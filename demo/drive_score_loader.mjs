import { register } from "node:module";

register(new URL("./drive_score_hook.mjs", import.meta.url), {
  parentURL: import.meta.url,
});
