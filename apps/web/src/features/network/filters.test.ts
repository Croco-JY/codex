import { expect, test } from "vitest";
import { parseDirectory, serializeDirectory, safeWebsite } from "./filters";
const id = "40000000-0000-4000-8000-000000000001";
test("Supplier transport keeps separate alpha2 countries and UUID references", () => {
  const p = parseDirectory(
    "suppliers",
    `q= Kyoto &country=jp&facilityCountry=cn&role=MILL&verificationStatus=AUDITED&region=${id}&cluster=${id}&capability=${id}`,
  );
  expect(p.filters).toEqual({
    q: "Kyoto",
    country: "JP",
    facilityCountry: "CN",
    role: "MILL",
    verificationStatus: "AUDITED",
    region: id,
    cluster: id,
    capability: id,
  });
  expect(serializeDirectory("suppliers", p.filters)).toBe(p.canonical);
});
test("Facility has its own enum and supplier UUID, never q", () => {
  const p = parseDirectory(
    "facilities",
    `q=secret&country=kr&type=WAREHOUSE&supplier=${id}&region=${id}&cluster=${id}&capability=${id}`,
  );
  expect(p.filters).toEqual({
    country: "KR",
    type: "WAREHOUSE",
    supplier: id,
    region: id,
    cluster: id,
    capability: id,
  });
  expect(p.cleaned).toBe(true);
});
test.each([
  "cursor=x&limit=100&token=x&actor=x&status=ARCHIVED",
  "country=" + id + "&region=JP&cluster=x&capability=x",
  "q=%00bad&role=WAREHOUSE&verificationStatus=SPECIALIST",
  "type=MATERIAL_SUPPLIER&supplier=JP",
])("removes unsupported/invalid filter values: %s", (input) => {
  expect(parseDirectory("suppliers", input).canonical).toBe("");
  expect(parseDirectory("facilities", input).canonical).toBe("");
});
test.each([
  "javascript:alert(1)",
  "data:text/html,x",
  "//example.com",
  "https://u:p@example.com",
  "https://example.com\n",
])("rejects unsafe external website %s", (v) =>
  expect(safeWebsite(v)).toBeUndefined(),
);
test("accepts only absolute public http/https links", () => {
  expect(safeWebsite("https://example.com")).toBe("https://example.com/");
  expect(safeWebsite("http://example.com/path")).toBe(
    "http://example.com/path",
  );
});
