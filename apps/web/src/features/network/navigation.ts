import { parseFilters } from "../materials/filters";
import { parseDirectory, validUuid } from "./filters";
export function networkReturn(
  state: unknown,
  fallback: "/suppliers" | "/facilities" = "/suppliers",
): string {
  if (
    !state ||
    typeof state !== "object" ||
    !("networkReturn" in state) ||
    typeof state.networkReturn !== "string"
  )
    return fallback;
  const target = state.networkReturn;
  if (target.length > 4096 || /[\\#\u0000-\u0020\u007f]/.test(target))
    return fallback;
  const material = /^\/materials(?:\?([^#\\]*))?$/.exec(target);
  if (material) {
    const canonical = parseFilters(material[1] ?? "").canonical;
    return `/materials${canonical ? `?${canonical}` : ""}`;
  }
  const record = /^\/(materials|material-listings)\/([^/?]+)$/.exec(target);
  if (record && validUuid(record[2]!))
    return `/${record[1]}/${record[2]!.toLowerCase()}`;
  const match = /^\/(suppliers|facilities)(?:\/([^/?]+))?(?:\?(.*))?$/.exec(
    target,
  );
  if (!match) return fallback;
  const kind = match[1] as "suppliers" | "facilities";
  if (match[2])
    return validUuid(match[2]) && !match[3]
      ? `/${kind}/${match[2].toLowerCase()}`
      : fallback;
  const canonical = parseDirectory(kind, match[3] ?? "").canonical;
  return `/${kind}${canonical ? `?${canonical}` : ""}`;
}
/** Carry one validated directory context across nested detail screens, without an arbitrary redirect chain. */
export function networkDirectory(
  state: unknown,
  fallback: "/suppliers" | "/facilities" = "/suppliers",
) {
  if (!state || typeof state !== "object") return fallback;
  const value =
    "networkDirectory" in state
      ? state.networkDirectory
      : "networkReturn" in state
        ? state.networkReturn
        : undefined;
  if (
    typeof value !== "string" ||
    !/^\/(suppliers|facilities)(?:\?[^#\\]*)?$/.test(value)
  )
    return fallback;
  return networkReturn({ networkReturn: value }, fallback);
}
