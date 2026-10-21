import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../app/queryClient";
import { ApiError, canRefreshRead } from "./errors";
import { api } from "./client";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "./session";
import { queryKeys } from "./queryKeys";

describe("query and request policies", () => {
  it.each([0, 500, 503])(
    "bounds transient GET retries for %s",
    async (status) => {
      const client = createQueryClient();
      const read = vi.fn().mockRejectedValue(new ApiError(status));
      await expect(
        client.fetchQuery({ queryKey: ["read"], queryFn: read, retryDelay: 0 }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(read).toHaveBeenCalledTimes(2);
      client.clear();
    },
  );
  it.each([400, 401, 403, 404, 409])(
    "does not retry a GET %s",
    async (status) => {
      const client = createQueryClient();
      const read = vi.fn().mockRejectedValue(new ApiError(status));
      await expect(
        client.fetchQuery({ queryKey: ["read"], queryFn: read, retryDelay: 0 }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(read).toHaveBeenCalledTimes(1);
      client.clear();
    },
  );
  it("does not automatically retry failed mutations", async () => {
    const client = createQueryClient();
    const write = vi.fn().mockRejectedValue(new ApiError(503));
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: write });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);
    expect(write).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it("sanitizes a network error without retaining the request or credentials", async () => {
    setAccessToken("synthetic-memory-credential");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unsafe request information"));
    try {
      const error = await api.GET("/api/identity").catch((error) => error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(0);
      expect(JSON.stringify(error)).not.toMatch(
        /synthetic|unsafe|Authorization|requestBody/,
      );
    } finally {
      spy.mockRestore();
      endSession();
    }
  });
  it("keeps credentials out of keys, browser storage and URLs", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const original = window.location.href;
    setAccessToken("synthetic-memory-credential");
    const a = getSession().key;
    setLocalSubject("private-actor");
    const b = getSession().key;
    expect(a).not.toBe(b);
    const keys = [
      queryKeys.identity(b),
      queryKeys.capabilities(b),
      queryKeys.organizations(b),
      queryKeys.supply(b, "materials"),
    ];
    expect(JSON.stringify(keys)).not.toMatch(
      /synthetic-memory-credential|private-actor|issuer|subject|email/,
    );
    expect(local).not.toHaveBeenCalled();
    expect(window.location.href).toBe(original);
    local.mockRestore();
    endSession();
  });
  it("rejects invalid DEV subjects before changing a session", () => {
    const before = getSession();
    expect(() => setLocalSubject("invalid subject <script>")).toThrow();
    expect(getSession()).toBe(before);
  });
});

it.each([400, 401, 403, 404, 409])(
  "background refresh does not retry terminal status %s",
  (status) => {
    expect(canRefreshRead(new ApiError(status))).toBe(false);
  },
);
