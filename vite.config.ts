// 作成日: 2026-07-18 / 作成担当: Codex
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pagesでは /serein-house/akari-cho/ 配下、ローカルでは / で開く。
  base: process.env.GITHUB_PAGES ? "/akari-cho/" : "/",
  server: { allowedHosts: ["meg1.tailaf24fe.ts.net"] },
});
