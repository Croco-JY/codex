import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError, responseError, retryRead } from "./errors";
import { ApiErrorState } from "../ui/ApiErrorState";

describe("safe HTTP error transport", () => {
  it.each([
    [400, "Check your input"],
    [401, "Authentication required"],
    [403, "Access denied"],
    [404, "Not found"],
    [409, "Reload required"],
    [412, "Precondition no longer holds"],
    [500, "Service unavailable"],
    [0, "Connection unavailable"],
  ])("distinguishes status %s", (status, title) => {
    render(<ApiErrorState error={new ApiError(status)} />);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
  });

  it("prefers a validated header reference and never retains arbitrary server details", async () => {
    const error = await responseError(
      new Response(
        JSON.stringify({
          requestId: "body-reference",
          detail:
            "Bearer confidential-value <script>window.injected=true</script>",
          stack: "internal trace",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/problem+json",
            "X-Request-ID": "header-reference",
          },
        },
      ),
    );
    render(<ApiErrorState error={error} />);
    expect(screen.getByText("header-reference")).toBeVisible();
    expect(document.body.textContent).not.toContain("confidential-value");
    expect(document.querySelector("script")).toBeNull();
    expect(JSON.stringify(error)).not.toMatch(
      /detail|stack|Bearer|confidential|internal/,
    );
  });

  it.each(["application/problem+json; charset=utf-8", "application/json"])(
    "reads a bounded JSON reference in %s",
    async (type) => {
      const error = await responseError(
        new Response('{"requestId":"body_123"}', {
          status: 409,
          headers: { "Content-Type": type, "X-Request-ID": "invalid id" },
        }),
      );
      expect(error.status).toBe(409);
      expect(error.requestId).toBe("body_123");
    },
  );

  it.each([
    ["application/problem+json", "{"],
    ["text/html", '<img src=x onerror="alert(1)">'],
    ["application/problem+json", JSON.stringify({ requestId: "x".repeat(65) })],
    [
      "application/problem+json",
      JSON.stringify({ requestId: "ref", detail: "x".repeat(9000) }),
    ],
    ["application/problem+json", "null"],
    ["application/problem+json", '[{"requestId":"not-an-object"}]'],
    ["application/problem+json", '{"requestId":"javascript:alert(1)"}'],
  ])(
    "preserves HTTP status for malformed/untrusted body %#",
    async (type, body) => {
      const error = await responseError(
        new Response(body, { status: 403, headers: { "Content-Type": type } }),
      );
      expect(error.status).toBe(403);
      expect(error.requestId).toBeUndefined();
      render(<ApiErrorState error={error} />);
      expect(
        screen.getByRole("heading", { name: "Access denied" }),
      ).toBeVisible();
      expect(document.body.textContent).not.toContain(body);
    },
  );

  it("rejects a declared oversized body without reading it", async () => {
    const error = await responseError(
      new Response('{"requestId":"untrusted"}', {
        status: 500,
        headers: {
          "Content-Type": "application/problem+json",
          "Content-Length": "100000",
        },
      }),
    );
    expect(error.requestId).toBeUndefined();
  });

  it("never renders an arbitrary exception message", () => {
    render(<ApiErrorState error={new Error("private credential and stack")} />);
    expect(
      screen.getByRole("heading", { name: "Service unavailable" }),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain("private credential");
  });

  it.each([400, 401, 403, 404, 409, 412])(
    "never automatically retries %s",
    (status) => {
      expect(retryRead(0, new ApiError(status))).toBe(false);
    },
  );
});
