import fs from "node:fs";
import path from "node:path";
import { APIRequestContext, expect, test } from "@playwright/test";
import {
  assertCameraPhotosIntact,
  attachErrorGuards,
  E2E_OUTPUTS_DIR,
  getCustomerHistorySection,
  getDefaultTwoSlotFrame,
  loginAdminPage,
  resetPhase6State,
  runDbHelper,
} from "./fixtures";

async function seedCustomerWithRenderedJob(
  request: APIRequestContext,
  name: string,
  frameId: number,
  slotIds: string[]
): Promise<{ sessionId: number; jobId: number; outputDir: string }> {
  const sessRes = await request.post("/api/sessions", {
    data: {
      name,
      whatsapp: "081234567890",
      email: `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
      consent_accepted: true,
    },
  });
  expect(sessRes.status()).toBe(201);
  const { id: sessionId, token } = (await sessRes.json()) as { id: number; token: string };

  const jobRes = await request.post(`/api/prints/${token}`, {
    data: {
      frame_id: frameId,
      copies: 1,
      selected_photos: [
        { slotId: slotIds[0], filename: "photo_1.jpg", offsetX: 0, offsetY: 0, zoom: 1 },
        { slotId: slotIds[1], filename: "photo_2.jpg", offsetX: 0, offsetY: 0, zoom: 1 },
      ],
    },
  });
  expect(jobRes.status()).toBe(201);
  const { id: jobId } = (await jobRes.json()) as { id: number };

  const outputDir = path.join(E2E_OUTPUTS_DIR, String(sessionId));
  const outputFile = path.join(outputDir, `${jobId}.jpg`);
  await expect.poll(() => fs.existsSync(outputFile), { timeout: 15_000 }).toBe(true);

  return { sessionId, jobId, outputDir };
}

test.describe("Phase 6: Customer Deletion, Conflict Guard & Camera Safety", () => {
  test.beforeEach(async ({ request }) => {
    await resetPhase6State(request);
  });

  test("confirms privacy nuance, blocks deletion (409) when job is printing, and deletes customer + outputs while preserving camera photos", async ({
    page,
    request,
  }) => {
    const guard = attachErrorGuards(page, { allowExpected409: true });
    const frame = await getDefaultTwoSlotFrame(request);

    const custA = await seedCustomerWithRenderedJob(
      request,
      "Bima Hapus",
      frame.id,
      frame.slotIds
    );
    const custB = await seedCustomerWithRenderedJob(
      request,
      "Citra Printing",
      frame.id,
      frame.slotIds
    );

    // Deterministically force Citra Printing's job into 'printing' state
    runDbHelper(["set-job-status", String(custB.jobId), "printing"]);

    await loginAdminPage(page);
    const historySection = getCustomerHistorySection(page);
    await expect(historySection.getByText("Menampilkan 2 dari 2 customer")).toBeVisible();

    const rowCitra = historySection.locator("tbody tr", { hasText: "Citra Printing" });
    const rowBima = historySection.locator("tbody tr", { hasText: "Bima Hapus" });
    await expect(rowCitra).toHaveCount(1);
    await expect(rowBima).toHaveCount(1);

    // 1. Attempt to delete Citra Printing -> verify confirm dialog nuance & 409 conflict block
    let confirmText = "";
    page.once("dialog", async (dialog) => {
      confirmText = dialog.message();
      await dialog.accept();
    });
    await rowCitra.getByRole("button", { name: "Hapus" }).click();

    expect(confirmText).toMatch(/Foto asli kamera.*TIDAK akan dihapus/i);
    expect(confirmText).toMatch(/thumbnail cache.*retensi/i);

    await expect(
      page.getByText(/Cannot delete customer data while a print job is actively printing/i)
    ).toBeVisible();
    await expect(rowCitra).toHaveCount(1);
    await expect(historySection.getByText("Menampilkan 2 dari 2 customer")).toBeVisible();
    expect(fs.existsSync(custB.outputDir)).toBe(true);
    assertCameraPhotosIntact();

    // 2. Delete Bima Hapus -> succeeds, deletes outputs dir, keeps camera photos intact
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await rowBima.getByRole("button", { name: "Hapus" }).click();

    await expect(
      page.getByText('Data customer "Bima Hapus" dihapus (foto asli kamera tetap aman).')
    ).toBeVisible();
    await expect(rowBima).toHaveCount(0);
    await expect(historySection.getByText("Menampilkan 1 dari 1 customer")).toBeVisible();
    expect(fs.existsSync(custA.outputDir)).toBe(false);
    assertCameraPhotosIntact();

    guard.assertClean();
  });
});
