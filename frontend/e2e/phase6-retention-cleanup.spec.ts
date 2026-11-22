import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertCameraPhotosIntact,
  attachErrorGuards,
  E2E_ADMIN_PIN,
  E2E_OUTPUTS_DIR,
  E2E_THUMBNAILS_DIR,
  getCustomerHistorySection,
  getPrintQueueSection,
  loginAdminPage,
  resetPhase6State,
  runDbHelper,
} from "./fixtures";

function writeFileWithMtime(filePath: string, content: string, mtimeDate: Date): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  fs.utimesSync(filePath, mtimeDate, mtimeDate);
}

test.describe("Phase 6: Retention Cleanup & UX Guards", () => {
  test.beforeEach(async ({ request }) => {
    await resetPhase6State(request);
  });

  test("saves retention/TTL, cleans expired thumbnails & outputs while preserving fresh files and camera photos, and handles corrupt DB retention_days", async ({
    page,
  }) => {
    const guard = attachErrorGuards(page);
    await loginAdminPage(page);

    const historySection = getCustomerHistorySection(page);
    const retentionInput = historySection.getByLabel("Retensi Cache/Output (hari):");
    const ttlInput = historySection.getByLabel("Masa Berlaku QR (jam):");

    await retentionInput.fill("3");
    await ttlInput.fill("6");
    await historySection.getByRole("button", { name: "Simpan Retensi" }).click();
    await expect(
      page.getByText("Pengaturan retensi & masa berlaku QR tersimpan.")
    ).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin Dashboard", exact: true })).toBeVisible();
    await expect(retentionInput).toHaveValue("3");
    await expect(ttlInput).toHaveValue("6");

    // Prepare expired (5 days ago) and fresh (1 hour ago) cache/output files + fresh empty dir
    const nowMs = Date.now();
    const expiredDate = new Date(nowMs - 5 * 86_400_000);
    const freshDate = new Date(nowMs - 3_600_000);

    const expiredThumb = path.join(E2E_THUMBNAILS_DIR, "expired-thumb.webp");
    const freshThumb = path.join(E2E_THUMBNAILS_DIR, "fresh-thumb.webp");
    const expiredOutputDir = path.join(E2E_OUTPUTS_DIR, "701");
    const expiredOutput = path.join(expiredOutputDir, "9001.jpg");
    const freshOutput = path.join(E2E_OUTPUTS_DIR, "702", "9002.jpg");
    const freshEmptyDir = path.join(E2E_OUTPUTS_DIR, "703");

    writeFileWithMtime(expiredThumb, "expired-thumb", expiredDate);
    writeFileWithMtime(freshThumb, "fresh-thumb", freshDate);
    writeFileWithMtime(expiredOutput, "expired-output", expiredDate);
    fs.utimesSync(expiredOutputDir, expiredDate, expiredDate);
    writeFileWithMtime(freshOutput, "fresh-output", freshDate);
    fs.mkdirSync(freshEmptyDir, { recursive: true });
    fs.utimesSync(freshEmptyDir, new Date(nowMs), new Date(nowMs));

    await historySection.getByRole("button", { name: "Bersihkan File Expired" }).click();
    await expect(
      page.getByText(/Cleanup selesai \(> 3 hari\): 1 thumbnail & 1 output dihapus/)
    ).toBeVisible();

    expect(fs.existsSync(expiredThumb)).toBe(false);
    expect(fs.existsSync(expiredOutput)).toBe(false);
    expect(fs.existsSync(expiredOutputDir)).toBe(false);
    expect(fs.existsSync(freshThumb)).toBe(true);
    expect(fs.existsSync(freshOutput)).toBe(true);
    expect(fs.existsSync(freshEmptyDir)).toBe(true);
    assertCameraPhotosIntact();

    // Corrupt retention_days in DB -> manual cleanup falls back safely to 7 days (no 500)
    const expiredNineDays = path.join(E2E_THUMBNAILS_DIR, "expired-9d.webp");
    const freshFiveDays = path.join(E2E_THUMBNAILS_DIR, "fresh-5d.webp");
    writeFileWithMtime(expiredNineDays, "old-9d", new Date(nowMs - 9 * 86_400_000));
    writeFileWithMtime(freshFiveDays, "fresh-5d", new Date(nowMs - 5 * 86_400_000));

    try {
      runDbHelper(["set-setting", "retention_days", "corrupt_value"]);
      const cleanupResPromise = page.waitForResponse(
        (res) =>
          res.url().includes("/api/admin/cleanup/run") && res.request().method() === "POST"
      );
      await historySection.getByRole("button", { name: "Bersihkan File Expired" }).click();
      const cleanupRes = await cleanupResPromise;
      expect(cleanupRes.status()).toBe(200);
      await expect(
        page.getByText(/Cleanup selesai \(> 7 hari\): 1 thumbnail & 0 output dihapus/)
      ).toBeVisible();

      expect(fs.existsSync(expiredNineDays)).toBe(false);
      expect(fs.existsSync(freshFiveDays)).toBe(true);
      assertCameraPhotosIntact();
    } finally {
      runDbHelper(["set-setting", "retention_days", "7"]);
    }
    guard.assertClean();
  });

  test("shows initial loading state and preserves dirty retention/TTL inputs when saving other settings", async ({
    page,
  }) => {
    const guard = attachErrorGuards(page);

    let releaseCustomers!: () => void;
    const customersGate = new Promise<void>((resolve) => {
      releaseCustomers = resolve;
    });
    let intercepted = false;

    await page.route("**/api/admin/customers*", async (route) => {
      if (!intercepted && route.request().method() === "GET") {
        intercepted = true;
        await customersGate;
      }
      await route.continue();
    });

    await page.goto("/admin");
    const pinInput = page.getByLabel("PIN Admin");
    await expect(
      page.getByRole("heading", { name: "Admin Dashboard", exact: true }).or(pinInput)
    ).toBeVisible();
    if (await pinInput.isVisible()) {
      await pinInput.fill(E2E_ADMIN_PIN);
      await page.getByRole("button", { name: "Masuk" }).click();
    }

    const historySection = getCustomerHistorySection(page);
    await expect(historySection.getByText("Memuat histori customer...")).toBeVisible();
    await expect(historySection.getByText("Belum ada data customer tercatat.")).toHaveCount(0);

    releaseCustomers();
    await expect(historySection.getByText("Belum ada data customer tercatat.")).toBeVisible();

    // Edit retention & TTL without saving them, then save printer settings
    const retentionInput = historySection.getByLabel("Retensi Cache/Output (hari):");
    const ttlInput = historySection.getByLabel("Masa Berlaku QR (jam):");
    await retentionInput.fill("14");
    await ttlInput.fill("12");

    const printSection = getPrintQueueSection(page);
    await printSection.getByRole("button", { name: "Simpan Printer" }).click();
    await expect(page.getByText("Pengaturan printer & mode cetak tersimpan.")).toBeVisible();

    await expect(retentionInput).toHaveValue("14");
    await expect(ttlInput).toHaveValue("12");
    guard.assertClean();
  });
});
