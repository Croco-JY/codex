import { describe, expect, test } from "vitest";
import { nextOffset, ambiguous, isAbort } from "./data";
import { ApiError } from "../../api/errors";
import {
  accessMethods,
  editableSource,
  isUuid,
  observationBody,
  observationDefaults,
  observationFields,
  permissions,
  recordFields,
  recordKinds,
  reviewBody,
  reviewDefaults,
  reviewFields,
  reviewStatuses,
  safeVersion,
  sourceBody,
  sourceDefaults,
  sourceFields,
  sourceTypes,
  utcInstant,
  validSourceUrl,
} from "./model";
const id = "50000000-0000-4000-8000-000000000001";
const fields = {
  ...sourceDefaults,
  sourceCode: "JaPan.Partner_Feed-01",
  name: "Synthetic Source",
};
describe("Source identity and defensive hydration", () => {
  test.each(["A", "a.B_C-0", "a".repeat(100)])(
    "preserves valid Source code %s",
    (sourceCode) => {
      const parsed = sourceFields.parse({ ...fields, sourceCode });
      expect(sourceBody(parsed, 0)).toEqual({
        sourceCode,
        name: "Synthetic Source",
        sourceType: "MANUAL_ENTRY",
        accessMethod: "MANUAL",
        normalizationPolicy: "PRESERVE",
        active: true,
        version: 0,
      });
    },
  );
  test.each([
    "",
    ".abc",
    " abc",
    "abc ",
    "abc\n",
    "한국",
    "A/B",
    "a".repeat(101),
  ])("rejects invalid Source code %j", (sourceCode) => {
    expect(sourceFields.safeParse({ ...fields, sourceCode }).success).toBe(
      false,
    );
  });
  test.each([undefined, null, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, "0"])(
    "rejects unsafe version %s",
    (version) => {
      expect(safeVersion(version)).toBe(false);
      expect(
        editableSource({ ...fields, id, version } as never),
      ).toBeUndefined();
    },
  );
  test("hydrates exact current version and active=false without inventing missing state", () => {
    const source = { ...fields, id, version: 7, active: false };
    expect(editableSource(source)).toEqual({
      id,
      version: 7,
      fields: { ...fields, active: false },
    });
    for (const missing of [
      "id",
      "sourceCode",
      "sourceType",
      "name",
      "accessMethod",
      "normalizationPolicy",
      "active",
      "version",
    ]) {
      const incomplete = { ...source } as Record<string, unknown>;
      delete incomplete[missing];
      expect(editableSource(incomplete)).toBeUndefined();
    }
  });
  test("optional fields are omitted, never empty/null; accepted URL and namespace are unchanged", () => {
    const baseUrl = "https://Example.com:443/Path?q=AbC%2FZ";
    const sent = sourceBody(
      { ...fields, namespace: "MiXeD namespace", baseUrl, active: false },
      4,
    );
    expect(sent).toMatchObject({
      baseUrl,
      namespace: "MiXeD namespace",
      active: false,
      version: 4,
      sourceCode: fields.sourceCode,
    });
    expect(sourceBody(fields, 0)).not.toHaveProperty("baseUrl");
    expect(sourceBody(fields, 0)).not.toHaveProperty("namespace");
  });
  test.each(sourceTypes)("accepts actual Source type %s", (sourceType) =>
    expect(sourceFields.safeParse({ ...fields, sourceType }).success).toBe(
      true,
    ),
  );
  test.each(accessMethods)("accepts actual access method %s", (accessMethod) =>
    expect(sourceFields.safeParse({ ...fields, accessMethod }).success).toBe(
      true,
    ),
  );
});
describe("raw URL syntax", () => {
  test.each([
    "",
    "http://localhost:8080/path?x=1",
    "https://Example.com/Case?key=A%2Fb",
    "http://[::1]:8080/hello",
  ])("allows valid original URL %s", (value) =>
    expect(validSourceUrl(value)).toBe(true),
  );
  test.each([
    "https://example.com/#",
    "https://example.com/#frag",
    "https://@example.com",
    "https://:@example.com",
    "https://name@example.com",
    "https://name:pass@example.com",
    "ftp://example.com",
    "//example.com",
    " https://example.com",
    "https://example.com/a b",
    "https://example.com\\evil",
    "https://%65xample.com",
    "https://bad_host.test",
    "https://例.jp",
    "https://example.com:65536",
    "https://",
  ])("rejects unsupported raw URL %s", (value) =>
    expect(validSourceUrl(value)).toBe(false),
  );
});
describe("Record identity", () => {
  test.each(recordKinds)(
    "accepts the actual kind %s and preserves the raw external key",
    (recordKind) => {
      expect(
        recordFields.parse({
          recordKind,
          externalRecordKey: "  MiXeD-会社-e\u0301  ",
        }).externalRecordKey,
      ).toBe("  MiXeD-会社-e\u0301  ");
    },
  );
  test("rejects blank keys and invalid known UUID without normalization", () => {
    expect(
      recordFields.safeParse({
        recordKind: "SUPPLIER",
        externalRecordKey: "   ",
      }).success,
    ).toBe(false);
    expect(isUuid(id)).toBe(true);
    for (const bad of ["", id + "\n", " " + id, "not-a-uuid"])
      expect(isUuid(bad)).toBe(false);
  });
});
describe("Observation facts", () => {
  const draft = {
    ...observationDefaults,
    observationKey: " MiXeD-Key ",
    observedAt: "2026-10-21T12:34",
  };
  test("omits both hash fields and optional timestamps/supersession", () => {
    expect(observationBody(id, observationFields.parse(draft))).toEqual({
      sourceRecordId: id,
      observationKey: " MiXeD-Key ",
      observedAt: "2026-10-21T12:34:00Z",
    });
  });
  test("preserves microseconds, adds exact hash pair and explicit supersession", () => {
    const body = observationBody(
      id,
      observationFields.parse({
        ...draft,
        observedAt: "2026-10-21T12:34:56.123456",
        retrievedAt: "2026-10-21T13:00:01",
        contentHash: "a".repeat(64),
        supersedesObservationId: id,
      }),
    );
    expect(body).toMatchObject({
      observedAt: "2026-10-21T12:34:56.123456Z",
      retrievedAt: "2026-10-21T13:00:01Z",
      contentHash: "a".repeat(64),
      hashAlgorithm: "SHA-256",
      supersedesObservationId: id,
    });
    expect(body).not.toHaveProperty("actorIssuer");
  });
  test.each([
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    "a".repeat(64) + "\n",
  ])("rejects invalid hash without repairing case/length", (contentHash) =>
    expect(observationFields.safeParse({ ...draft, contentHash }).success).toBe(
      false,
    ),
  );
  test.each([
    "",
    "2026-02-30T12:34",
    "2026-10-21T25:00",
    "2026-10-21T12:34:00.1234567",
    "10/21/2026 12:34",
    "2026-10-21T12:34Z",
  ])("rejects invalid control timestamp %s", (value) =>
    expect(utcInstant(value)).toBeUndefined(),
  );
  test("required Observation key is not fabricated", () =>
    expect(
      observationFields.safeParse({ ...draft, observationKey: " " }).success,
    ).toBe(false));
});
describe("append-only Review serialization", () => {
  test.each(reviewStatuses)(
    "sends only selected Review status %s",
    (reviewStatus) => {
      expect(
        reviewBody(reviewFields.parse({ ...reviewDefaults, reviewStatus })),
      ).toEqual({ reviewStatus });
    },
  );
  test.each(permissions)(
    "sends explicitly selected permission %s",
    (permission) => {
      expect(
        reviewBody({
          ...reviewDefaults,
          licenseStatus: permission,
          termsStatus: permission,
        }),
      ).toEqual({
        reviewStatus: "NEEDS_REVIEW",
        licenseStatus: permission,
        termsStatus: permission,
      });
    },
  );
  test("notes preserve text with a 1000-character bound and no client reviewer identity", () => {
    expect(
      reviewFields.safeParse({ ...reviewDefaults, notes: "n".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      reviewBody({ ...reviewDefaults, notes: " Original notes " }),
    ).toEqual({ reviewStatus: "NEEDS_REVIEW", notes: " Original notes " });
  });
});
test("offset sequences remain bounded and an exactly full page allows one more request", () => {
  expect(nextOffset(Array(25), [], 0)).toBe(25);
  expect(nextOffset(Array(25), [], 25)).toBe(50);
  expect(nextOffset([], [], 50)).toBeUndefined();
  expect(nextOffset(Array(24), [], 0)).toBeUndefined();
  expect(nextOffset(Array(25), [], 100000)).toBeUndefined();
});
test("only ApiError status0 is ambiguity; explicit HTTP and AbortError are different", () => {
  expect(ambiguous(new ApiError(0))).toBe(true);
  for (const status of [400, 403, 404, 409, 500])
    expect(ambiguous(new ApiError(status))).toBe(false);
  const abort = new DOMException("Cancelled", "AbortError");
  expect(isAbort(abort)).toBe(true);
  expect(ambiguous(abort)).toBe(false);
});
