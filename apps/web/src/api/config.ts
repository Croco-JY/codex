/** Public build configuration only; never consult navigation, storage or API response data. */
export function resolveApiOrigin(
  configured: string | undefined,
  currentOrigin: string,
  development: boolean,
): string {
  const value = configured?.trim();
  if (!value) return currentOrigin;
  const invalid = () => new Error("Invalid API origin configuration.");
  // Check the raw syntax before URL normalization can hide paths, backslashes or userinfo.
  if (!/^https?:\/\/[^/?#\\\s@]+\/?$/i.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw invalid();
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    url.origin !== currentOrigin &&
    !(development && loopback)
  )
    throw invalid();
  return url.origin;
}
