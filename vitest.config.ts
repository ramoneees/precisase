import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    server: {
      // next-auth v5 transitively imports `next/server`, whose package
      // `exports` map only resolves under Next's bundler. Under vitest's
      // Node ESM loader it fails with "Cannot find module .../next/server"
      // — so any test that pulls in `next-auth` (e.g. mfa-challenge.test.ts
      // for the `CredentialsSignin`/`AuthError` instanceof contract) blows
      // up at import. Alias it to an empty module; nothing under test
      // actually uses the values next-auth re-exports from there.
      deps: {
        inline: ["next-auth"],
      },
    },
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
