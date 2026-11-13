import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "ui"),
      "@dynatrace-sdk/react-hooks": path.resolve(
        __dirname,
        "ui/shims/dynatrace-react-hooks.ts"
      ),
    },
  },
  build: {
    outDir: "dist",
  },
});
