import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Vitest doesn't auto-detect Testing Library's Jest-only cleanup hook, so
// unmount rendered trees between tests explicitly to avoid leakage.
afterEach(() => {
  cleanup();
});
