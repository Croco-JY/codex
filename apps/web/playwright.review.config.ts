import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "**/*.review.ts",
  use: { ...base.use, viewport: { width: 1440, height: 1000 } },
});
