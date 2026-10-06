import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const raiz = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const porta = Number(process.env.PORT) || 3030;
const api = `http://127.0.0.1:${porta}`;

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __VERSAO__: JSON.stringify(raiz.version),
    __DATA__: JSON.stringify(raiz.buildDate),
  },
  resolve: { dedupe: ["react", "react-dom", "react-router", "lucide-react"] },
  build: { outDir: "../dist/public", emptyOutDir: true },
  server: {
    port: 5173,
    // API do portal e os módulos repassados (prefixos do registro)
    proxy: { "/api": api, "/cronogramas": api, "/financeiro": api, "/cp": api },
  },
});
