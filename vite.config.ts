import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  // Use relative asset paths so dist/index.html works when opened via file://
  base: "./",
  esbuild: {
    target: "es2019",
  },
  plugins: [
    legacy({
      targets: ["safari >= 12"],
      modernPolyfills: true,
    }),
    {
      name: "remove-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?(?=\s|>)/g, "");
      },
    },
  ],
});
