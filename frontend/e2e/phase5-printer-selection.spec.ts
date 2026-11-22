import { expect, test } from "@playwright/test";
import {
  attachErrorGuards,
  completeCustomerSelection,
  ensureStudioConfigured,
  getJobCard,
  loginAdminPage,
  readPrintedJobs,
  resetPrintState,
  setPrinterMode,
} from "./fixtures";

test.describe("Phase 5: Printer Selection & Status Refresh", () => {
  test.beforeEach(async ({ request }) => {
    await ensureStudioConfigured(request);
    await resetPrintState(request);
  });

  test("persists selected printer, routes job to chosen printer, and reflects offline status", async ({
    page,
    context,
  }) => {
    const adminGuard = attachErrorGuards(page);
    await loginAdminPage(page);

    const printSection = page
      .getByRole("heading", { name: /Print Queue/ })
      .locator("xpath=ancestor::section[1]");
    const printerSelect = printSection.locator("select").first();

    await expect(printerSelect.locator("option", { hasText: /Mock Photo Printer/ })).toHaveCount(1);
    await expect(printerSelect.locator("option", { hasText: /Backup Printer/ })).toHaveCount(1);
    await expect(printSection.getByText("Siap", { exact: true })).toBeVisible();

    // Select Backup Printer, save, reload, and verify persistence
    await printerSelect.selectOption("Backup Printer");
    await printSection.getByRole("button", { name: "Simpan Printer" }).click();
    await expect(page.getByText("Pengaturan printer & mode cetak tersimpan.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
    await expect(printerSelect).toHaveValue("Backup Printer");

    // Submit a customer job in a second tab and print it to Backup Printer
    const kioskPage = await context.newPage();
    const kioskGuard = attachErrorGuards(kioskPage);
    try {
      const { token } = await completeCustomerSelection(kioskPage, {
        name: "Riko Printer",
        copies: 1,
      });

      const submitResPromise = kioskPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
      );
      await kioskPage.getByRole("button", { name: "Cetak", exact: true }).click();
      const submitRes = await submitResPromise;
      expect(submitRes.status()).toBe(201);
      const { id: jobId } = (await submitRes.json()) as { id: number };

      const jobCard = getJobCard(page, jobId);
      await expect(jobCard).toBeVisible({ timeout: 15_000 });
      await expect(jobCard.getByRole("button", { name: "Print Sekarang" })).toBeEnabled({
        timeout: 15_000,
      });
      await jobCard.getByRole("button", { name: "Print Sekarang" }).click();

      await expect(jobCard.getByText("Tercetak", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(() => readPrintedJobs().length, { timeout: 10_000 }).toBe(1);
      expect(readPrintedJobs()[0].printer_name).toBe("Backup Printer");

      // Set printer offline and click Cek Printer
      setPrinterMode("offline", "Printer offline test");
      await printSection.getByRole("button", { name: "Cek Printer" }).click();
      await expect(printSection.getByText("Offline", { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      adminGuard.assertClean();
      kioskGuard.assertClean();
    } finally {
      await kioskPage.close();
    }
  });
});
