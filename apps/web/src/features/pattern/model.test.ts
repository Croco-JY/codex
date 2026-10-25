import { describe, test, expect } from "vitest";
import { pattern, revision, S, PID, id } from "../../test/patternFixture";
import {
  checkedPattern,
  checkedPage,
  checkedHistory,
  checkedRevision,
  bodyOf,
  draftOf,
} from "./model";
import { ApiError } from "../../api/errors";
describe("strict immutable Pattern hydration", () => {
  test("valid explicit-offset metadata and null pin", () => {
    const p = pattern();
    p.createdAt = "2026-10-25T09:00:00+09:00";
    expect(checkedPattern(p, S, PID)).toBe(p);
    expect(checkedRevision(revision(), S, PID)).toEqual(revision());
  });
  test.each([
    ["createdAt", "2026-10-25"],
    ["updatedAt", "2026-10-25T00:00:00"],
    ["version", -1],
    ["version", Number.MAX_SAFE_INTEGER + 1],
    ["version", "0"],
    ["status", "REVIEWED"],
    ["id", "bad"],
    ["styleId", id(99)],
    ["latestRevision", null],
  ])("reject Pattern %s %s", (k, v) => {
    expect(() => checkedPattern({ ...pattern(), [k]: v } as never, S)).toThrow(
      ApiError,
    );
  });
  test.each([
    ["revisionNumber", 0],
    ["revisionNumber", Number.MAX_SAFE_INTEGER + 1],
    ["revisionNumber", "1"],
    ["createdAt", "2026-10-25"],
    ["createdAt", "2026-10-25T12:00:00"],
    ["name", " name"],
    ["name", ""],
    ["name", "x".repeat(161)],
    ["purpose", " "],
    ["purpose", "x".repeat(161)],
    ["measurementRevisionId", "bad"],
    ["patternId", id(99)],
    ["styleId", id(99)],
    ["id", "bad"],
  ])("reject revision %s %s", (k, v) => {
    expect(() =>
      checkedRevision({ ...revision(), [k]: v } as never, S, PID),
    ).toThrow(ApiError);
  });
  test("route exact revision ID and latest parent", () => {
    expect(() => checkedRevision(revision(), S, PID, id(99))).toThrow(ApiError);
    expect(() =>
      checkedPattern(
        { ...pattern(), latestRevision: { ...revision(), patternId: id(99) } },
        S,
      ),
    ).toThrow(ApiError);
  });
  test.each(["", "a b", "x".repeat(2049), 42])(
    "bad collection cursor %s fails",
    (c) => {
      expect(() =>
        checkedPage(
          { items: [pattern()], limit: 25, nextCursor: c } as never,
          S,
          "ACTIVE",
        ),
      ).toThrow(ApiError);
    },
  );
  test("collection filter/duplicates/shape fail closed", () => {
    for (const p of [
      { items: [pattern(), pattern()], limit: 25, nextCursor: null },
      {
        items: [{ ...pattern(), status: "ARCHIVED" }],
        limit: 25,
        nextCursor: null,
      },
      { items: [], limit: 24, nextCursor: null },
    ])
      expect(() => checkedPage(p as never, S, "ACTIVE")).toThrow(ApiError);
    expect(
      checkedPage({ items: [], limit: 25, nextCursor: null }, S, "ALL").items,
    ).toEqual([]);
  });
  test.each([0, -1, 4, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "bad history cursor %s",
    (c) => {
      expect(() =>
        checkedHistory(
          {
            items: [revision(3)],
            limit: 25,
            nextMaxRevisionNumber: c,
          } as never,
          S,
          PID,
          3,
        ),
      ).toThrow(ApiError);
    },
  );
  test("history order/head and ownership checked", () => {
    for (const items of [
      [revision(2), revision(3)],
      [revision(4)],
      [revision(2), revision(2)],
      [{ ...revision(), styleId: id(99) }],
    ])
      expect(() =>
        checkedHistory(
          { items, limit: 25, nextMaxRevisionNumber: null },
          S,
          PID,
          3,
        ),
      ).toThrow(ApiError);
  });
  test("new draft is independent and exact allowed body only", () => {
    const p = pattern(),
      d = draftOf(p.latestRevision);
    d.name = " Revised ";
    d.purpose = " ";
    d.measurementRevisionId = id(70);
    expect(p.latestRevision.name).toBe("Pattern revision 1");
    expect(bodyOf(d)).toEqual({
      name: "Revised",
      purpose: null,
      measurementRevisionId: id(70),
    });
    expect(() =>
      bodyOf({ ...d, measurementRevisionId: "1-1-1-1-1" }),
    ).toThrow();
  });
});
