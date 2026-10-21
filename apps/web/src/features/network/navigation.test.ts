import { expect, test } from "vitest";
import { networkReturn } from "./navigation";
const id = "40000000-0000-4000-8000-000000000001";
test.each([
  `/suppliers/${id}`,
  `/facilities/${id}`,
  `/materials/${id}`,
  `/material-listings/${id}`,
])("valid internal record return %s", (networkReturnValue) =>
  expect(networkReturn({ networkReturn: networkReturnValue })).toBe(
    networkReturnValue,
  ),
);
test("directory return strips unsupported/auth/cursor keys", () =>
  expect(
    networkReturn({ networkReturn: "/suppliers?country=JP&token=x&cursor=x" }),
  ).toBe("/suppliers?country=JP"));
test.each([
  "https://evil.test",
  "//evil.test",
  "/admin",
  "/suppliers/evil",
  "/facilities\\evil",
  "/suppliers#bad",
  "/facilities?country=JP\n",
  "/materials/" + id + "?token=x",
])("unsafe return %s uses route-specific fallback", (v) => {
  expect(networkReturn({ networkReturn: v })).toBe("/suppliers");
  expect(networkReturn({ networkReturn: v }, "/facilities")).toBe(
    "/facilities",
  );
});
