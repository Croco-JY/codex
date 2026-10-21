import { parseFilters } from "./filters";
/** Only the discovery route and its accepted shareable filters may be carried as return context. */
export function discoveryReturn(state: unknown): string {
  if (
    !state ||
    typeof state !== "object" ||
    !("discoveryReturn" in state) ||
    typeof state.discoveryReturn !== "string"
  )
    return "/materials";
  const target = state.discoveryReturn;
  if (
    target.length > 4096 ||
    !/^\/materials(?:\?[^#\\]*)?$/.test(target) ||
    /[\u0000-\u001f]/.test(target)
  )
    return "/materials";
  const canonical = parseFilters(target.slice("/materials".length)).canonical;
  return `/materials${canonical ? `?${canonical}` : ""}`;
}
