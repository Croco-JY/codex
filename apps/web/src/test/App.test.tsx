import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, test, expect, afterEach } from "vitest";
import App from "../App";
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
test("renders shell and real API response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (req: Request) =>
        new Response(
          JSON.stringify(
            req.url.includes("/api/health")
              ? { status: "UP", application: "SOURCE OS" }
              : { subject: "tester", issuer: "local" },
          ),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  mount();
  expect(screen.getByRole("navigation")).toBeVisible();
  expect(await screen.findByText("API UP")).toBeVisible();
  expect(screen.queryByText("Materials")).not.toBeInTheDocument();
});
test("failed API is visible with retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  );
  mount();
  expect(await screen.findByText("The API is unavailable.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
});
