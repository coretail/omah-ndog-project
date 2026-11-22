import { expect, Page, test } from "@playwright/test";
import {
  adminHeaders,
  attachErrorGuards,
  ensureStudioConfigured,
  getJobCard,
  loginAdminPage,
  resetPrintState,
} from "./fixtures";

async function selectPhotosAndSubmitOnMobile(
  mobilePage: Page,
  token: string,
  copies: number
): Promise<number> {
  await mobilePage.goto(`/s/${token}`);
  await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/frame$`));
  await mobilePage.getByRole("button", { name: "Pilih Foto" }).click();

  await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/photo$`));
  const thumbs = mobilePage.locator('button img[src*="/thumb"]');
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(0).click();
  await thumbs.nth(1).click();
  await mobilePage.getByRole("button", { name: "Cetak", exact: true }).click();

  await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/preview$`));
  for (let i = 1; i < copies; i++) {
    await mobilePage.getByRole("button", { name: "Tambah jumlah cetak" }).click();
  }

  const submitResPromise = mobilePage.waitForResponse(
    (res) =>
      res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
  );
  await mobilePage.getByRole("button", { name: "Cetak", exact: true }).click();
  const submitRes = await submitResPromise;
  expect(submitRes.status()).toBe(201);
  const { id } = (await submitRes.json()) as { id: number };

  await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/printing$`));
  await expect(mobilePage.getByText("Menunggu Antrean Cetak")).toBeVisible();
  return id;
}

test.describe("Phase 5: Mobile Multi-Device Print Jobs & Queue Security", () => {
  test.beforeEach(async ({ request }) => {
    await ensureStudioConfigured(request);
    await resetPrintState(request);
  });

  test("isolates independent mobile print jobs and enforces queue/IDOR/tunnel security", async ({
    browser,
    request,
  }) => {
    const kioskContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const phoneAContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phoneBContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const adminContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    const kioskPage = await kioskContext.newPage();
    const phoneA = await phoneAContext.newPage();
    const phoneB = await phoneBContext.newPage();
    const adminPage = await adminContext.newPage();

    const kioskGuard = attachErrorGuards(kioskPage);
    const guardA = attachErrorGuards(phoneA);
    const guardB = attachErrorGuards(phoneB);
    const adminGuard = attachErrorGuards(adminPage);

    try {
      // 1. Register customer session from Kiosk
      await kioskPage.goto("/");
      await kioskPage.getByLabel("Name", { exact: true }).fill("Grup Cetak");
      await kioskPage.getByLabel("Whatsapp", { exact: true }).fill("081277766655");
      await kioskPage.getByLabel("Email", { exact: true }).fill("grup-cetak@example.com");
      await kioskPage.getByRole("checkbox").check();
      await kioskPage.getByRole("button", { name: "NEXT" }).click();

      await expect(kioskPage).toHaveURL(/\/s\/[^/]+\/qr$/);
      const match = kioskPage.url().match(/\/s\/([^/]+)\/qr$/);
      expect(match).not.toBeNull();
      const token = match![1];

      // 2. Phone A and Phone B submit independent print jobs on the same QR token
      const jobIdA = await selectPhotosAndSubmitOnMobile(phoneA, token, 2);
      const jobIdB = await selectPhotosAndSubmitOnMobile(phoneB, token, 1);
      expect(jobIdA).not.toBe(jobIdB);

      // 3. Admin sees 2 separate job cards and prints only jobIdA
      await loginAdminPage(adminPage);
      const cardA = getJobCard(adminPage, jobIdA);
      const cardB = getJobCard(adminPage, jobIdB);
      await expect(cardA).toBeVisible({ timeout: 15_000 });
      await expect(cardB).toBeVisible({ timeout: 15_000 });

      // 6. Verify Admin output thumbnails use blob: URLs (no token in query string) and load cleanly
      const outputImages = adminPage.locator('img[alt^="Output #"]');
      await expect
        .poll(async () => await outputImages.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      const imgCount = await outputImages.count();
      for (let i = 0; i < imgCount; i++) {
        const img = outputImages.nth(i);
        const src = await img.getAttribute("src");
        expect(src).toMatch(/^blob:/);
        await expect
          .poll(
            async () =>
              img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
            { timeout: 10_000 }
          )
          .toBe(true);
      }

      await expect(cardA.getByRole("button", { name: "Print Sekarang" })).toBeEnabled({
        timeout: 15_000,
      });
      await cardA.getByRole("button", { name: "Print Sekarang" }).click();
      await expect(cardA.getByText("Tercetak", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      await expect(phoneA.getByText("Selesai Dicetak")).toBeVisible({ timeout: 15_000 });
      await expect(phoneB.getByText("Menunggu Antrean Cetak")).toBeVisible();

      // 4. Cross-session IDOR check: another session token cannot read jobIdA
      const sess2Res = await request.post("/api/sessions", {
        data: {
          name: "Sesi Lain",
          whatsapp: "081200000099",
          email: "lain@example.com",
          consent_accepted: true,
        },
      });
      expect(sess2Res.status()).toBe(201);
      const { token: token2 } = (await sess2Res.json()) as { token: string };
      const idorRes = await request.get(`/api/prints/${token2}/${jobIdA}`);
      expect(idorRes.status()).toBe(404);

      // 5. Queue endpoint auth (401) & anti-tunnel header guard (403)
      const unauthRes = await request.get("/api/prints/queue");
      expect(unauthRes.status()).toBe(401);

      const headers = await adminHeaders(request);
      const tunnelRes = await request.get("/api/prints/queue", {
        headers: {
          ...headers,
          "CF-Connecting-IP": "203.0.113.50",
        },
      });
      expect(tunnelRes.status()).toBe(403);

      kioskGuard.assertClean();
      guardA.assertClean();
      guardB.assertClean();
      adminGuard.assertClean();
    } finally {
      await kioskContext.close();
      await phoneAContext.close();
      await phoneBContext.close();
      await adminContext.close();
    }
  });
});
