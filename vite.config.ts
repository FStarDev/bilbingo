import { defineConfig } from "vite";

export default defineConfig({
  // Use relative asset paths so dist/index.html works when opened via file://
  base: "./",
  plugins: [
    {
      name: "remove-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?(?=\s|>)/g, "");
      },
    },
  ],
});
