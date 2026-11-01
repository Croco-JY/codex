import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

const NativeRequest = globalThis.Request;
const requestInputs = new WeakMap<Request, Request>();
class BrowserRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    // Node 24 may collect an intermediate Request and lose its abort-following
    // link. Chromium keeps cancellation connected. Model that browser behavior
    // for mocked fetches, retaining inputs only while their request is alive.
    // Native AbortSignals, production code and cancellation assertions stay intact.
    if (input instanceof NativeRequest) requestInputs.set(this, input);
  }
}
beforeEach(() => {
  globalThis.Request = BrowserRequest;
});
afterEach(() => {
  cleanup();
  globalThis.Request = NativeRequest;
});
