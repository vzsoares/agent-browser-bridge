import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default {
  plugins: [crx({ manifest })],
};
