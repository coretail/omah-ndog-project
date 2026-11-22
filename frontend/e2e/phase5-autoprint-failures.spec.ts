import { expect, Page, test } from "@playwright/test";
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

async function submitCustomerJob(
  page: Page,
  name: string
): Promise<{ token: string; jobId: number }> {
  const { token } = await completeCustomerSelection(page, { name, copies: 1 });
  const submitResPromise = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Cetak", exact: true }).click();
  const submitRes = await submitResPromise;
  expect(submitRes.status()).toBe(201);
  const { id } = (await submitRes.json()) as { id: number };
  await expect(page).toHaveURL(new RegExp(`/s/${token}/printing$`));
  return { token, jobId: id };
}

test.describe("Phase 5: Auto-Print, Printer Failures, Retry & Cancel", () => {
  test.beforeEach(async ({ request }) => {
    await ensureStudioConfigured(request);
    await resetPrintState(request);
  });

  test("handles offline/paper_out/error failures, retry recovery, cancel, and auto-print success", async ({
    page,
    context,
  }) => {
    const kioskGuard = attachErrorGuards(page);
    const adminPage = await context.newPage();
    const adminGuard = attachErrorGuards(adminPage);

    try {
      // 1. Enable Auto-Print in Admin and set printer offline
      await loginAdminPage(adminPage);
      await adminPage.getByLabel(/Auto-Print aktif/).check();
      await adminPage.getByRole("button", { name: "Simpan Printer" }).click();
      await expect(
        adminPage.getByText("Pengaturan printer & mode cetak tersimpan.")
      ).toBeVisible();

      setPrinterMode("offline", "Kabel printer terputus");

      // 2. Customer submits -> fails with offline error on both Kiosk and Admin
      const { jobId: jobId1 } = await submitCustomerJob(page, "Sinta Auto");
      await expect(page.getByText(/Gagal Mencetak — Hubungi Operator/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/Kabel printer terputus/)).toBeVisible({
        timeout: 15_000,
      });

      const card1 = getJobCard(adminPage, jobId1);
      await expect(card1).toBeVisible({ timeout: 15_000 });
      await expect(card1.getByText("Gagal", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(card1).toContainText("Kabel printer terputus");

      // 3. Switch to paper_out and click Retry -> still fails with paper out message
      setPrinterMode("paper_out", "Kertas printer simulasi habis.");
      await card1.getByRole("button", { name: "Retry" }).click();
      await expect(card1).toContainText("Kertas printer simulasi habis.", {
        timeout: 15_000,
      });
      await expect(card1.getByText("Gagal", { exact: true })).toBeVisible();

      // 4. Restore ready and click Retry -> printed
      setPrinterMode("ready", "");
      await card1.getByRole("button", { name: "Retry" }).click();
      await expect(card1.getByText("Tercetak", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Selesai Dicetak")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => readPrintedJobs().length, { timeout: 10_000 }).toBe(1);

      // 5. Simulate error -> new job fails -> Cancel removes Retry/Cancel without printing
      setPrinterMode("error", "Head printer panas");
      const { jobId: jobId2 } = await submitCustomerJob(page, "Tono Error");
      const card2 = getJobCard(adminPage, jobId2);
      await expect(card2.getByText("Gagal", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(card2).toContainText("Head printer panas");

      adminPage.once("dialog", (dialog) => dialog.accept());
      await card2.getByRole("button", { name: "Cancel" }).click();
      await expect(card2.getByText("Dibatalkan", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(card2.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await expect(card2.getByRole("button", { name: "Cancel" })).toHaveCount(0);
      expect(readPrintedJobs()).toHaveLength(1);

      // 6. Ready + Auto-Print -> new job prints automatically without operator click
      setPrinterMode("ready", "");
      const { jobId: jobId3 } = await submitCustomerJob(page, "Dina Lancar");
      await expect(page.getByText("Selesai Dicetak")).toBeVisible({ timeout: 15_000 });
      const card3 = getJobCard(adminPage, jobId3);
      await expect(card3.getByText("Tercetak", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(() => readPrintedJobs().length, { timeout: 10_000 }).toBe(2);

      kioskGuard.assertClean();
      adminGuard.assertClean();
    } finally {
      await adminPage.close();
    }
  });
});
