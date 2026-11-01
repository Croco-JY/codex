import { test, expect } from "@playwright/test";
import {
  setup,
  release,
  login,
  createForm,
  api,
} from "./pattern-release-fixture";
test("actual server 15-minute consent expiry and expired release deny without renewal or retry", async ({
  page,
  request,
}) => {
  test.setTimeout(17 * 60 * 1000);
  const f = await setup(request);
  await login(page, f, f.consentRoute);
  await page
    .getByLabel("Intended source Organization UUID", { exact: true })
    .fill(f.a.id);
  await page
    .getByRole("button", { name: "Issue consent", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Exact consent" }),
  ).toContainText("ISSUED");
  const rows = await request.get(api + f.consentApi, {
      headers: f.recipientHeaders,
    }),
    consent = (await rows.json()).items[0];
  const short = await release(request, f, 1);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          api + f.inboxApi + "/" + short.release.id,
          { headers: f.recipientHeaders },
        );
        return (await response.json()).effectiveState;
      },
      { timeout: 5000, intervals: [50, 100, 250] },
    )
    .toBe("EXPIRED");
  await login(page, f, f.inboxRoute + "/" + short.release.id);
  await expect(page.getByText("EXPIRED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download exact artifact", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.get(
        api + f.inboxApi + "/" + short.release.id + "/content",
        { headers: f.recipientHeaders },
      )
    ).status(),
  ).toBe(404);
  // No clock mocks, old-row updates, trigger changes or shorter production consent policy.
  await expect
    .poll(
      async () => {
        const response = await request.get(
          api + f.consentApi + "/" + consent.id,
          { headers: f.recipientHeaders },
        );
        expect(response.status()).toBe(200);
        return (await response.json()).state;
      },
      { timeout: 16 * 60 * 1000, intervals: [1000, 2000] },
    )
    .toBe("EXPIRED");
  let submissions = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(f.sourceApi)) submissions++;
  });
  await login(page, f, f.sourceRoute, f.owner);
  await createForm(page, consent.id);
  const rejected = page.waitForResponse(
    (r) => r.url().endsWith(f.sourceApi) && r.status() === 409,
  );
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  await rejected;
  await expect(
    page.getByRole("region", { name: "Reconcile uncertain outcome" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Recipient-issued consent ID", { exact: true }),
  ).toHaveValue(consent.id);
  expect(submissions).toBe(1);
});
