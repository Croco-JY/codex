import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { resolveApiOrigin } from "./config";
import { ApiError, responseError, safeRequestId } from "./errors";
import { applyCredentials, expireSession, getSession } from "./session";
export { setAccessToken, setLocalSubject } from "./session";

const apiOrigin = resolveApiOrigin(
  import.meta.env.VITE_API_BASE_URL,
  window.location.origin,
  import.meta.env.DEV,
);
function requireTrustedTarget(request: Request) {
  if (new URL(request.url).origin !== apiOrigin) throw new ApiError(400);
}
const requestScopes = new WeakMap<Request, string>();
export const api = createClient<paths>({
  baseUrl: apiOrigin,
  // Do not forward authentication headers through an API redirect.
  redirect: "error",
  fetch: async (request) => {
    const scope = requestScopes.get(request);
    if (scope !== getSession().key || request.signal.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    requireTrustedTarget(request);
    let response: Response;
    try {
      response = await globalThis.fetch(request);
    } catch {
      if (request.signal.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      throw new ApiError(0);
    }
    if (scope !== getSession().key || request.signal.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (!response.ok) {
      const error = await responseError(response);
      if (scope !== getSession().key || request.signal.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      if (response.status === 401) expireSession(scope, error.requestId);
      throw error;
    }
    return response;
  },
});
api.use({
  onRequest({ request }) {
    requireTrustedTarget(request);
    // Per-call options cannot opt an authenticated request into following redirects.
    request = new Request(request, { redirect: "error" });
    requestScopes.set(request, getSession().key);
    request.headers.set("X-Request-ID", crypto.randomUUID());
    applyCredentials(request.headers);
    return request;
  },
});
export function requireData<T>(data: T | undefined, response: Response): T {
  if (data === undefined)
    throw new ApiError(
      502,
      safeRequestId(response.headers.get("X-Request-ID")),
    );
  return data;
}
