import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "api",
          root: "api",
          include: ["testes/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: "./web/vite.config.ts",
        test: {
          name: "web",
          root: "web",
          include: ["testes/**/*.test.tsx"],
          environment: "jsdom",
          // o kit passa pelo Vite: uma única cópia de react e react-router
          server: { deps: { inline: ["plataforma-kit"] } },
        },
      },
    ],
  },
});
