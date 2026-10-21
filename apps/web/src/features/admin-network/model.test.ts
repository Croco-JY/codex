import { expect, test } from "vitest";
import { roles, facilityTypes } from "../network/filters";
import {
  supplierFields,
  supplierDefaults,
  supplierBaseline,
  supplierBody,
  aliasFields,
  aliasBody,
  aliasTypes,
  verificationFields,
  manualVerification,
  supplierFacts,
  facilityFacts,
  facilityFields,
  facilityDefaults,
  facilityBaseline,
  facilityBody,
  coordinate,
  scaled,
  quantity,
  assignmentFields,
  assignmentDefaults,
  assignmentBaseline,
  assignmentBody,
  capabilityUnits,
  capabilityVerifications,
  proficiencies,
  parseCitation,
} from "./model";
const a = "1c5b0000-0000-4000-8000-000000000001",
  b = "1c5b0000-0000-4000-8000-000000000002";
const supplier = {
  ...supplierDefaults,
  countryId: a,
  displayName: "Mixed-Case Supplier",
  observationId: b,
};
const facility = {
  ...facilityDefaults,
  supplierId: a,
  countryId: b,
  name: "Physical site",
  observationId: a,
};
const assignment = { ...assignmentDefaults, observationId: a };

test("Supplier create serializes Country UUID, explicit zero version, empty roles and no verification field", () => {
  expect(supplierFields.parse(supplier).roles).toEqual([]);
  expect(supplierBody(supplier, 0)).toEqual({
    countryId: a,
    displayName: "Mixed-Case Supplier",
    status: "ACTIVE",
    roles: [],
    observationId: b,
    version: 0,
  });
});
test.each(roles)("Supplier role %s is legal without a primary role", (role) =>
  expect(supplierFields.safeParse({ ...supplier, roles: [role] }).success).toBe(
    true,
  ),
);
test("full role replacement and optional-string clearing do not fabricate values", () => {
  const v = {
    ...supplier,
    roles: ["MILL" as const],
    legalName: "Original legal",
    websiteUrl: "https://Example.com:443/Path?Q=MiXeD",
  };
  expect(supplierBody(v, 7)).toMatchObject({
    version: 7,
    roles: ["MILL"],
    websiteUrl: v.websiteUrl,
  });
  expect(
    supplierBody({ ...v, roles: [], legalName: "", websiteUrl: "" }, 8),
  ).not.toHaveProperty("legalName");
  expect(
    supplierBody({ ...v, roles: [], legalName: "", websiteUrl: "" }, 8),
  ).not.toHaveProperty("websiteUrl");
});
test.each([
  "https://@example.com",
  "https://user:pass@example.com",
  "https://example.com/#",
  "javascript:alert(1)",
  "https://example.com/path#fragment",
])("Supplier rejects unsafe original website %s", (websiteUrl) =>
  expect(supplierFields.safeParse({ ...supplier, websiteUrl }).success).toBe(
    false,
  ),
);
test("Supplier baseline requires actual roles and all current identity/version fields", () => {
  const v = {
    ...supplier,
    id: a,
    version: 0,
    verificationStatus: "DISCOVERED",
  };
  expect(supplierBaseline(v)?.fields.roles).toEqual([]);
  for (const field of [
    "id",
    "countryId",
    "displayName",
    "status",
    "verificationStatus",
    "roles",
    "version",
  ]) {
    const row: Record<string, unknown> = { ...v };
    delete row[field];
    expect(supplierBaseline(row), field).toBeUndefined();
  }
  expect(supplierBaseline({ ...v, roles: ["UNSUPPORTED"] })).toBeUndefined();
  expect(
    supplierBaseline({ ...v, legalName: { secret: "never stringify" } }),
  ).toBeUndefined();
});
test.each([
  undefined,
  null,
  -1,
  0.1,
  "0",
  Number.MAX_SAFE_INTEGER + 1,
  Infinity,
])(
  "unsafe version %s cannot hydrate Supplier/Facility/Capability",
  (version) => {
    expect(
      supplierBaseline({
        ...supplier,
        id: a,
        version,
        verificationStatus: "DISCOVERED",
      }),
    ).toBeUndefined();
    expect(facilityBaseline({ ...facility, id: a, version })).toBeUndefined();
    expect(
      assignmentBaseline(
        { ...assignment, facilityId: a, capabilityId: b, version },
        a,
        b,
      ),
    ).toBeUndefined();
  },
);
test.each(aliasTypes)(
  "Alias type %s and original spelling survive transport",
  (aliasType) => {
    const v = {
      alias: "  MiXeD 日本語  ",
      languageCode: "ja-JP",
      aliasType,
      observationId: a,
    };
    expect(aliasBody(aliasFields.parse(v), 4)).toEqual({ ...v, version: 4 });
  },
);
test.each(["en", "zh-Hant", "en_US", "AbCdEfGh-ABC12345"])(
  "valid language code %s is preserved",
  (languageCode) =>
    expect(
      aliasFields.safeParse({
        alias: "Alias",
        aliasType: "ORIGINAL",
        languageCode,
        observationId: a,
      }).success,
    ).toBe(true),
);
test.each(["e", "englishlong", "en-", "en-123456789", " en", "en@JP"])(
  "invalid language code %s is blocked",
  (languageCode) =>
    expect(
      aliasFields.safeParse({
        alias: "Alias",
        aliasType: "ORIGINAL",
        languageCode,
        observationId: a,
      }).success,
    ).toBe(false),
);
test.each(manualVerification)(
  "manual target %s is allowed independently of a monotonic ladder",
  (status) =>
    expect(
      verificationFields.safeParse({
        status,
        reason: "Reviewed supporting observation",
        observationId: a,
      }).success,
    ).toBe(true),
);
test.each(["CLAIMED", "TRANSACTED", "PROVEN"])(
  "manual target %s is intentionally unavailable",
  (status) =>
    expect(
      verificationFields.safeParse({
        status,
        reason: "Review",
        observationId: a,
      }).success,
    ).toBe(false),
);
test("reason is required, bounded and rejects sensitive text", () => {
  for (const reason of [
    "",
    " ",
    "x".repeat(1001),
    "Authorization: confidential",
  ]) {
    expect(
      verificationFields.safeParse({
        status: "AUDITED",
        reason,
        observationId: a,
      }).success,
    ).toBe(false);
  }
});
test.each(facilityTypes)(
  "Facility type %s remains independent of Supplier roles",
  (facilityType) =>
    expect(
      facilityFields.safeParse({ ...facility, facilityType }).success,
    ).toBe(true),
);
test("Facility full-replacement transport fixes canonical parent and omits absent fields", () => {
  expect(facilityBody({ ...facility, supplierId: b }, 3, a)).toEqual({
    supplierId: a,
    countryId: b,
    facilityType: "OFFICE",
    name: "Physical site",
    status: "ACTIVE",
    observationId: a,
    version: 3,
  });
});
test("Facility baseline rejects malformed optional IDs/contact/decimals and missing parent", () => {
  const v = { ...facility, id: a, version: 0 };
  expect(facilityBaseline(v)).toBeDefined();
  for (const patch of [
    { supplierId: undefined },
    { countryId: undefined },
    { name: undefined },
    { facilityType: "MATERIAL_SUPPLIER" },
    { regionId: "not UUID" },
    { latitude: 0, longitude: "0" },
    { email: "invalid" },
    { phone: 42 },
  ])
    expect(facilityBaseline({ ...v, ...patch })).toBeUndefined();
});
test.each([
  ["0", "0"],
  ["-90", "180"],
  ["90.000000", "-180.000000"],
  ["35.123456", "135.999999"],
  ["+0.000001", "-0.000001"],
])("coordinates %s/%s remain exact strings", (latitude, longitude) => {
  const v = { ...facility, latitude, longitude };
  expect(facilityFields.safeParse(v).success).toBe(true);
  expect(facilityBody(v, 0, a)).toMatchObject({ latitude, longitude });
});
test.each([
  ["90.000001", "0"],
  ["-90.000001", "0"],
  ["0", "180.000001"],
  ["0", "-180.000001"],
  ["1e1", "0"],
  ["0.0000001", "0"],
  ["", "0"],
  ["0", ""],
  [".5", "0"],
])("invalid coordinate pair %s/%s is rejected", (latitude, longitude) =>
  expect(
    facilityFields.safeParse({ ...facility, latitude, longitude }).success,
  ).toBe(false),
);
test("exact scaled validation does not round coordinate bounds or large quantities", () => {
  expect(scaled("-90.000000", 6)).toBe(-90_000_000n);
  expect(coordinate("90.000001", "latitude")).toBe(false);
  expect(scaled("999999999999999.9999", 4)).toBe(9999999999999999999n);
});
test.each(["0", "0.0000", "999999999999999.9999", "123.45"])(
  "legal Capability quantity %s is preserved",
  (minimumOrderQuantity) => {
    const v = {
      ...assignment,
      minimumOrderQuantity,
      quantityUnit: "METER" as const,
    };
    expect(assignmentFields.safeParse(v).success).toBe(true);
    expect(assignmentBody(v, 6).minimumOrderQuantity).toBe(
      minimumOrderQuantity,
    );
  },
);
test.each([
  "-1",
  "1000000000000000",
  "0.00001",
  "1e3",
  "NaN",
  "Infinity",
  "1,000",
  ".5",
])("illegal Capability quantity %s is blocked", (minimumOrderQuantity) =>
  expect(
    assignmentFields.safeParse({
      ...assignment,
      minimumOrderQuantity,
      quantityUnit: "METER",
    }).success,
  ).toBe(false),
);
test("Capability quantities require unit and use exact min/max comparison", () => {
  expect(assignmentFields.safeParse(assignment).success).toBe(true);
  expect(assignmentBody(assignment, 0)).toEqual({
    verificationStatus: "UNVERIFIED",
    observationId: a,
    version: 0,
  });
  for (const patch of [
    { minimumOrderQuantity: "0" },
    { maximumOrderQuantity: "1" },
    {
      minimumOrderQuantity: "999999999999999.9999",
      maximumOrderQuantity: "999999999999999.9998",
      quantityUnit: "METER",
    },
  ])
    expect(
      assignmentFields.safeParse({ ...assignment, ...patch }).success,
    ).toBe(false);
  expect(quantity("999999999999999.9999")).toBe(true);
});
test.each(capabilityUnits)("Capability unit %s is offered", (quantityUnit) =>
  expect(
    assignmentFields.safeParse({
      ...assignment,
      quantityUnit,
      minimumOrderQuantity: "0",
    }).success,
  ).toBe(true),
);
test.each(["FT2", "ROLL", "HIDE", "SET", "PACK"])(
  "broader Material unit %s is not a Capability unit",
  (quantityUnit) =>
    expect(
      assignmentFields.safeParse({ ...assignment, quantityUnit }).success,
    ).toBe(false),
);
test.each(proficiencies)(
  "proficiency %s is distinct from Supplier verification",
  (proficiencyLevel) =>
    expect(
      assignmentFields.safeParse({ ...assignment, proficiencyLevel }).success,
    ).toBe(true),
);
test.each(capabilityVerifications)(
  "Capability verification %s is legal",
  (verificationStatus) =>
    expect(
      assignmentFields.safeParse({ ...assignment, verificationStatus }).success,
    ).toBe(true),
);
test("protected Capability hydration validates identity/version and preserves notes/zero", () => {
  const raw = {
    facilityId: a,
    capabilityId: b,
    version: 0,
    verificationStatus: "AUDITED",
    notes: "Protected existing notes",
    proficiencyLevel: null,
    maximumOrderQuantity: null,
    minimumOrderQuantity: "0.0000",
    quantityUnit: "METER",
  };
  expect(assignmentBaseline(raw, a, b)?.fields).toMatchObject({
    notes: raw.notes,
    minimumOrderQuantity: "0.0000",
  });
  expect(assignmentBaseline({ ...raw, facilityId: b }, a, b)).toBeUndefined();
  expect(assignmentBaseline({ ...raw, capabilityId: a }, a, b)).toBeUndefined();
  expect(assignmentBaseline({ ...raw, notes: {} }, a, b)).toBeUndefined();
  expect(
    assignmentBaseline({ ...raw, minimumOrderQuantity: 0 }, a, b),
  ).toBeUndefined();
});
test.each([{ allowed: supplierFacts }, { allowed: facilityFacts }])(
  "citation parser only exposes checked snake_case keys",
  ({ allowed }) => {
    const raw = {
      source_observation_id: a,
      field_name: allowed[0],
      created_at: "2026-10-21T12:00:00.123456Z",
      unexpected: { secret: "never rendered" },
    };
    expect(parseCitation(raw, allowed)).toEqual({
      observationId: a,
      fieldName: allowed[0],
      createdAt: raw.created_at,
    });
    for (const patch of [
      { source_observation_id: undefined },
      { source_observation_id: 4 },
      { field_name: {} },
      { field_name: "INVENTED" },
      { created_at: {} },
      { created_at: "not date" },
    ])
      expect(parseCitation({ ...raw, ...patch }, allowed)).toBeUndefined();
    expect(
      parseCitation({ arbitrary: { secret: "never rendered" } }, allowed),
    ).toBeUndefined();
  },
);

test("unknown omitted optional edit state is not fabricated as an empty value", () => {
  const v = {
    ...supplier,
    id: a,
    version: 0,
    verificationStatus: "DISCOVERED",
  };
  for (const key of [
    "legalName",
    "nativeName",
    "englishName",
    "businessRegistrationNumber",
    "websiteUrl",
    "description",
  ]) {
    const partial: Record<string, unknown> = { ...v };
    delete partial[key];
    expect(supplierBaseline(partial)).toBeUndefined();
  }
  const f = { ...facility, id: a, version: 0 };
  for (const key of [
    "latitude",
    "longitude",
    "email",
    "regionId",
    "industrialClusterId",
  ]) {
    const partial: Record<string, unknown> = { ...f };
    delete partial[key];
    expect(facilityBaseline(partial)).toBeUndefined();
  }
  const c = { ...assignment, facilityId: a, capabilityId: b, version: 0 };
  const partial: Record<string, unknown> = { ...c };
  delete partial.notes;
  expect(assignmentBaseline(partial, a, b)).toBeUndefined();
});
