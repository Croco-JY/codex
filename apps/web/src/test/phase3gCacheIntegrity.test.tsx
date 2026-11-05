import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { endSession } from "../api/session";
import { queryKeys } from "../api/queryKeys";
import { checkedSpec } from "../features/measurement/model";
import { fixture, A, B, P, S, spec } from "./measurementFixture";

afterEach(() => {
  cleanup(); endSession(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test("G4 cached foreign Measurement identity cannot replace current authorized page facts", async () => {
  const h = fixture();
  h.specs.set(A, spec()); h.specs.set(B, spec(1, B));
  h.mount();
  await screen.findByRole("heading", { name: "Latest revision 1" });
  await screen.findByRole("button", { name: "Open revision 1" });
  const key = queryKeys.measurementSpec(h.scope, A, P, S);
  const original = structuredClone(h.cache.getQueryData(key));
  expect(original).toEqual(spec());
  const foreign = structuredClone(spec(1, B));
  foreign.latestRevision.points[0].notes = "3G FOREIGN POM MUST NOT RENDER";
  foreign.latestRevision.points[0].value = "321.1234";
  foreign.latestRevision.baseSize = "FOREIGN-B";
  // The existing accepted network validator rejects this exact wrong-Style DTO.
  expect(() => checkedSpec(foreign, S)).toThrow();
  await act(async () => { h.cache.setQueryData(key, foreign); });
  const page = within(screen.getByRole("region", { name: "Measurement workspace" }));
  // Wait for observable processing of the replacement, whether safe or unsafe.
  await waitFor(() => expect(
    page.queryByRole("alert") ?? page.queryByText("3G FOREIGN POM MUST NOT RENDER"),
  ).not.toBeNull());
  expect(page.queryByText("3G FOREIGN POM MUST NOT RENDER")).not.toBeInTheDocument();
  expect(page.queryByText("FOREIGN-B")).not.toBeInTheDocument();
  expect(h.writes()).toHaveLength(0);
  expect(h.calls.filter(r => r.url.endsWith("/content"))).toHaveLength(0);
});
