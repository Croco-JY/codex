import { afterEach, expect, it, vi } from "vitest";
const originalUrl = window.location.href;
afterEach(() => {
  window.history.replaceState(null, "", originalUrl);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});
function success() {
  return new Response(
    JSON.stringify({ issuer: "local", subject: "synthetic" }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
async function configuredClient(value?: string) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", value ?? "");
  const { api } = await import("./client");
  const session = await import("./session");
  return { api, session };
}

it("uses a configured HTTPS API origin while preserving request IDs and memory-only credentials", async () => {
  const { api, session } = await configuredClient(
    "https://api.example.invalid",
  );
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (request) => {
      expect(request).toBeInstanceOf(Request);
      return success();
    });
  session.setAccessToken("synthetic-memory-credential");
  await api.GET("/api/identity");
  const bearer = fetch.mock.calls[0]![0];
  expect(bearer).toBeInstanceOf(Request);
  if (!(bearer instanceof Request)) throw new Error("Expected API request");
  expect(bearer.url).toBe("https://api.example.invalid/api/identity");
  expect(bearer.headers.get("Authorization")).toBe(
    "Bearer synthetic-memory-credential",
  );
  expect(bearer.headers.get("X-Request-ID")).toMatch(/^[a-f0-9-]{36}$/);
  expect(bearer.redirect).toBe("error");
  session.setLocalSubject("synthetic-local-actor");
  await api.GET("/api/identity");
  const local = fetch.mock.calls[1]![0];
  if (!(local instanceof Request)) throw new Error("Expected API request");
  expect(new URL(local.url).origin).toBe("https://api.example.invalid");
  expect(local.headers.get("Authorization")).toBeNull();
  expect(local.headers.get("X-Dev-Subject")).toBe("synthetic-local-actor");
  const { queryKeys } = await import("./queryKeys");
  expect(
    JSON.stringify(queryKeys.identity(session.getSession().key)),
  ).not.toMatch(/synthetic|credential|actor/);
  expect(storage).not.toHaveBeenCalled();
  expect(window.location.href).toBe(originalUrl);
  session.endSession();
});

it("ignores query and stored endpoint values when defaulting to the frontend origin", async () => {
  window.history.replaceState(
    null,
    "",
    "/?VITE_API_BASE_URL=https://untrusted.example.invalid&api=https://other.example.invalid",
  );
  const storage = vi
    .spyOn(Storage.prototype, "getItem")
    .mockReturnValue("https://untrusted.example.invalid");
  const { api } = await configuredClient();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(success());
  await api.GET("/api/identity");
  const request = fetch.mock.calls[0]![0];
  if (!(request instanceof Request)) throw new Error("Expected API request");
  expect(request.url).toBe(window.location.origin + "/api/identity");
  expect(storage).not.toHaveBeenCalled();
});

it("rejects per-call untrusted API targets before attaching or sending credentials", async () => {
  const { api, session } = await configuredClient(
    "https://api.example.invalid",
  );
  session.setAccessToken("synthetic-memory-credential");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(success());
  await expect(
    api.GET("/api/identity", { baseUrl: "https://untrusted.example.invalid" }),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
  session.endSession();
});

it("does not allow per-call redirect options to forward credentials elsewhere", async () => {
  const { api, session } = await configuredClient(
    "https://api.example.invalid",
  );
  session.setLocalSubject("synthetic-local-actor");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      if (!(input instanceof Request)) throw new Error("Expected API request");
      expect(input.redirect).toBe("error");
      // Native fetch rejects an HTTP redirect in this mode before following it.
      throw new TypeError("Synthetic redirect rejected");
    });
  await expect(
    api.GET("/api/identity", { redirect: "follow" }),
  ).rejects.toMatchObject({ status: 0 });
  expect(fetch).toHaveBeenCalledTimes(1);
  session.endSession();
});

it("keeps a late cross-origin 401 from ending the replacement session", async () => {
  const { api, session } = await configuredClient(
    "https://api.example.invalid",
  );
  let resolve!: (response: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>((done) => {
    started = done;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    started();
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  session.setLocalSubject("synthetic-actor-a");
  const pending = api.GET("/api/identity").catch((error) => error);
  await entered;
  session.setLocalSubject("synthetic-actor-b");
  const current = session.getSession().key;
  resolve(new Response("{}", { status: 401 }));
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(session.getSession().key).toBe(current);
  expect(session.getSession().ended).toBe(false);
  session.endSession();
});

it("ignores an aborted request's late 401 within the same Actor session", async () => {
  const { api, session } = await configuredClient();
  session.setLocalSubject("synthetic-workspace-actor");
  const scope = session.getSession().key;
  let resolve!: (r: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>((done) => {
    started = done;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    started();
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  const controller = new AbortController();
  const pending = api
    .GET("/api/identity", { signal: controller.signal })
    .catch((error) => error);
  await entered;
  controller.abort();
  resolve(new Response("{}", { status: 401 }));
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(session.getSession().key).toBe(scope);
  expect(session.getSession().ended).toBe(false);
  session.endSession();
});
