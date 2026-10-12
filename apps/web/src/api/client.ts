import createClient from "openapi-fetch";
import type { paths } from "./schema";
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  fetch: (request) => globalThis.fetch(request),
});
let accessToken: string | undefined;
let localSubject: string | undefined;
export function setAccessToken(token?: string) {
  accessToken = token;
}
export function setLocalSubject(subject?: string) {
  if (import.meta.env.DEV) localSubject = subject;
}
api.use({
  onRequest({ request }) {
    request.headers.set("X-Request-ID", crypto.randomUUID());
    if (accessToken)
      request.headers.set("Authorization", `Bearer ${accessToken}`);
    if (import.meta.env.DEV && localSubject)
      request.headers.set("X-Dev-Subject", localSubject);
    return request;
  },
});
export function failure(response: Response): Error {
  return new Error(
    `Request failed (${response.status}). Reference: ${response.headers.get("X-Request-ID") ?? "unavailable"}.`,
  );
}
