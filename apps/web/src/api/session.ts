// Credentials never leave this memory-only adapter except as request headers.
let accessToken: string | undefined;
let localSubject: string | undefined;
let authenticated = false;
let snapshot = {
  key: crypto.randomUUID() as string,
  local: false,
  ended: false,
  requestId: undefined as string | undefined,
};
const listeners = new Set<() => void>();
const resets = new Set<() => void>();

export function getSession() {
  return snapshot;
}
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function beforeSessionReset(reset: () => void) {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}
function change(update: () => void, ended = false, requestId?: string) {
  // Cancellation aborts active read signals synchronously before credentials/scope change.
  resets.forEach((reset) => reset());
  update();
  authenticated = false;
  snapshot = {
    key: crypto.randomUUID(),
    local: Boolean(localSubject),
    ended,
    requestId,
  };
  listeners.forEach((listener) => listener());
}
export function setAccessToken(token?: string) {
  change(() => {
    accessToken = token || undefined;
    localSubject = undefined;
  });
}
export function setLocalSubject(subject?: string) {
  if (import.meta.env.DEV) {
    if (subject !== undefined && !/^[A-Za-z0-9._@-]{1,255}$/.test(subject))
      throw new Error("Enter a valid local development identity.");
    change(() => {
      localSubject = subject;
      accessToken = undefined;
    }, !subject);
  }
}
export function endSession(requestId?: string) {
  change(
    () => {
      accessToken = undefined;
      localSubject = undefined;
    },
    true,
    requestId,
  );
}
export function renewSession() {
  change(() => {});
}
export function identityEstablished(scope: string) {
  if (scope === snapshot.key) authenticated = true;
}
export function expireSession(scope: string, requestId?: string) {
  if (scope === snapshot.key && (authenticated || accessToken || localSubject))
    endSession(requestId);
}
export function applyCredentials(headers: Headers) {
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (import.meta.env.DEV && localSubject)
    headers.set("X-Dev-Subject", localSubject);
}
