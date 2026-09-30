import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: { port: 4002, strictPort: true },
  test: { environment: "happy-dom", root: "frontend" },
});
