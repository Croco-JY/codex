import { describe, expect, it } from "vitest";
import { resolveApiOrigin } from "./config";
const origin = "https://app.example.invalid";
describe("trusted API build configuration", () => {
  it.each([undefined, "", "   "])(
    "defaults to the current origin for %s",
    (value) => {
      expect(resolveApiOrigin(value, origin, false)).toBe(origin);
      expect(resolveApiOrigin(value, "http://app.example.invalid", false)).toBe(
        "http://app.example.invalid",
      );
    },
  );
  it("accepts a production HTTPS origin and normalizes its optional root slash", () => {
    expect(
      resolveApiOrigin(" https://api.example.invalid/ ", origin, false),
    ).toBe("https://api.example.invalid");
  });
  it("allows an explicitly configured exact same HTTP origin", () => {
    expect(
      resolveApiOrigin(
        "http://app.example.invalid/",
        "http://app.example.invalid",
        false,
      ),
    ).toBe("http://app.example.invalid");
  });
  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ])("permits DEV loopback %s only in development", (value) => {
    expect(resolveApiOrigin(value, origin, true)).toBe(value);
    expect(() => resolveApiOrigin(value, origin, false)).toThrow(
      "Invalid API origin configuration.",
    );
  });
  it.each([
    "not a URL",
    "//api.example.invalid",
    "/api",
    "https://",
    "https://api.example.invalid:invalid",
    "javascript:alert(1)",
    "data:text/plain,test",
    "file:///tmp/api",
    "https://user:password@api.example.invalid",
    "https://user@api.example.invalid",
    "https://@api.example.invalid",
    "https://api.example.invalid/api",
    "https://api.example.invalid/../",
    "https://api.example.invalid/%2e/",
    "https://api.example.invalid//",
    "https://api.example.invalid?target=other",
    "https://api.example.invalid#fragment",
    "https://api.example.invalid\\@other.example.invalid",
    "https://api.exa\nmple.invalid",
  ])(
    "rejects malformed, credential-bearing or non-origin configuration %#",
    (value) => {
      expect(() => resolveApiOrigin(value, origin, false)).toThrow(
        "Invalid API origin configuration.",
      );
    },
  );
  it.each([
    "http://api.example.invalid",
    "http://localhost.example.invalid:8080",
    "http://192.168.1.10:8080",
  ])("rejects non-loopback cross-origin HTTP even in DEV %#", (value) => {
    expect(() => resolveApiOrigin(value, origin, true)).toThrow();
    expect(() => resolveApiOrigin(value, origin, false)).toThrow();
  });
});
