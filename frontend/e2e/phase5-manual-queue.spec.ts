import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  attachErrorGuards,
  completeCustomerSelection,
  ensureStudioConfigured,
  getJobCard,
  loginAdminPage,
  readJpegInfo,
  readPrintedJobs,
  resetPrintState,
} from "./fixtures";

test.describe("Phase 5: Manual Queue & 300 DPI Download", () => {
  test.beforeEach(async ({ request }) => {
    await ensureStudioConfigured(request);
    await resetPrintState(request);
  });

  test("holds job in Manual Queue, downloads accurate 300 DPI JPEG, and prints on operator trigger", async ({
    page,
    context,
  }) => {
    const kioskGuard = attachErrorGuards(page);
    const { token } = await completeCustomerSelection(page, {
      name: "Nadia Manual",
      copies: 2,
    });

    await expect(page.getByText("02", { exact: true })).toBeVisible();
    await expect(page.getByText("Rp 30.000")).toBeVisible();

    const submitResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Cetak", exact: true }).click();
    const submitRes = await submitResponsePromise;
    expect(submitRes.status()).toBe(201);
    const submitted = (await submitRes.json()) as { id: number };
    const jobId = submitted.id;

    await expect(page).toHaveURL(new RegExp(`/s/${token}/printing$`));
    await expect(page.getByText("Menunggu Antrean Cetak")).toBeVisible();
    expect(readPrintedJobs()).toHaveLength(0);

    // Open Admin tab and verify job card & 300 DPI output
    const adminPage = await context.newPage();
    const adminGuard = attachErrorGuards(adminPage);
    try {
      await loginAdminPage(adminPage);

      const jobCard = getJobCard(adminPage, jobId);
      await expect(jobCard).toBeVisible({ timeout: 15_000 });
      await expect(jobCard).toContainText("Nadia Manual");
      await expect(jobCard).toContainText("2 lbr");
      await expect(jobCard).toContainText("Rp 30.000");
      await expect(jobCard.getByText("Menunggu", { exact: true })).toBeVisible();

      const thumb = jobCard.locator('img[src^="blob:"]');
      await expect(thumb).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () =>
            thumb.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          { timeout: 10_000 }
        )
        .toBe(true);

      // Download 300 DPI JPEG and verify pixel dimensions + DPI metadata
      const downloadPromise = adminPage.waitForEvent("download");
      await jobCard.getByRole("button", { name: "Download 300 DPI" }).click();
      const download = await downloadPromise;
      const downloadedPath = await download.path();
      expect(downloadedPath).not.toBeNull();
      const jpegInfo = readJpegInfo(fs.readFileSync(downloadedPath!));
      expect(jpegInfo.width).toBe(1205);
      expect(jpegInfo.height).toBe(1795);
      expect(jpegInfo.dpiX).toBe(300);
      expect(jpegInfo.dpiY).toBe(300);

      // Trigger manual print
      await jobCard.getByRole("button", { name: "Print Sekarang" }).click();
      await expect(jobCard.getByText("Tercetak", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      await expect.poll(() => readPrintedJobs().length, { timeout: 10_000 }).toBe(1);
      const jobsLog = readPrintedJobs();
      expect(jobsLog[0].copies).toBe(2);
      expect(jobsLog[0].printer_name).toBe("Mock Photo Printer");

      // Customer tab updates to Selesai Dicetak
      await expect(page.getByText("Selesai Dicetak")).toBeVisible({ timeout: 15_000 });
      await expect(jobCard.getByRole("button", { name: "Print Sekarang" })).toHaveCount(0);

      kioskGuard.assertClean();
      adminGuard.assertClean();
    } finally {
      await adminPage.close();
    }
  });
});
