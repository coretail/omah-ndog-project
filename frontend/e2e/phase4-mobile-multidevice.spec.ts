import { expect, test } from "@playwright/test";
import {
  assertAllImagesLoaded,
  attachErrorGuards,
  ensureStudioConfigured,
} from "./fixtures";

test("Mobile QR flow at 390x844 isolates drafts and finish action across devices", async ({
  browser,
  request,
}) => {
  await ensureStudioConfigured(request);

  // 1. Register customer session from Kiosk desktop context
  const kioskContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const kioskPage = await kioskContext.newPage();
  const kioskGuard = attachErrorGuards(kioskPage);

  await kioskPage.goto("/");
  await kioskPage.getByLabel("Name", { exact: true }).fill("Grup Teman");
  await kioskPage.getByLabel("Whatsapp", { exact: true }).fill("081299988877");
  await kioskPage.getByLabel("Email", { exact: true }).fill("grup@example.com");
  await kioskPage.getByRole("checkbox").check();
  await kioskPage.getByRole("button", { name: "NEXT" }).click();

  await expect(kioskPage).toHaveURL(/\/s\/[^/]+\/qr$/);
  const match = kioskPage.url().match(/\/s\/([^/]+)\/qr$/);
  expect(match).not.toBeNull();
  const token = match![1];

  // 2. Open two independent mobile browsers scanning the same /s/:token URL
  const phoneAContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phoneBContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phoneA = await phoneAContext.newPage();
  const phoneB = await phoneBContext.newPage();
  const guardA = attachErrorGuards(phoneA);
  const guardB = attachErrorGuards(phoneB);

  try {
    await phoneA.goto(`/s/${token}`);
    await expect(phoneA).toHaveURL(new RegExp(`/s/${token}/frame$`));
    await phoneB.goto(`/s/${token}`);
    await expect(phoneB).toHaveURL(new RegExp(`/s/${token}/frame$`));

    // 3. Phone A selects photos, sets 03 copies, and reaches PrintingPage
    await phoneA.getByRole("button", { name: "Pilih Foto" }).click();
    await expect(phoneA).toHaveURL(new RegExp(`/s/${token}/photo$`));
    const thumbsA = phoneA.locator('button img[src*="/thumb"]');
    await expect(thumbsA).toHaveCount(3);
    await assertAllImagesLoaded(phoneA);
    await thumbsA.nth(0).click();
    await thumbsA.nth(1).click();
    await phoneA.getByRole("button", { name: "Cetak", exact: true }).click();

    await expect(phoneA).toHaveURL(new RegExp(`/s/${token}/preview$`));
    const plusA = phoneA.getByRole("button", { name: "Tambah jumlah cetak" });
    await plusA.click();
    await plusA.click();
    await expect(phoneA.getByText("03", { exact: true })).toBeVisible();
    await expect(phoneA.getByText("Rp 45.000")).toBeVisible();
    await phoneA.getByRole("button", { name: "Cetak", exact: true }).click();
    await expect(phoneA).toHaveURL(new RegExp(`/s/${token}/printing$`));

    // 4. Phone B's draft remains completely clean
    await phoneB.getByRole("button", { name: "Pilih Foto" }).click();
    await expect(phoneB).toHaveURL(new RegExp(`/s/${token}/photo$`));
    await expect(phoneB.getByText("0 / 2 slot terisi")).toBeVisible();

    // 5. Phone A clicks Selesai -> shows mobile Thank You screen without killing shared session
    phoneA.once("dialog", (dialog) => dialog.accept());
    await phoneA.getByRole("button", { name: "Selesai" }).click();
    await expect(phoneA.getByRole("heading", { name: "Terima Kasih!" })).toBeVisible();
    await expect(phoneA.getByRole("button", { name: "Kembali ke Awal" })).toHaveCount(0);

    // 6. Phone B can still complete its own selection and reach PrintingPage
    const thumbsB = phoneB.locator('button img[src*="/thumb"]');
    await expect(thumbsB).toHaveCount(3);
    await thumbsB.nth(1).click();
    await thumbsB.nth(2).click();
    await phoneB.getByRole("button", { name: "Cetak", exact: true }).click();

    await expect(phoneB).toHaveURL(new RegExp(`/s/${token}/preview$`));
    await expect(phoneB.getByText("01", { exact: true })).toBeVisible();
    await expect(phoneB.getByText("Rp 15.000")).toBeVisible();
    await phoneB.getByRole("button", { name: "Cetak", exact: true }).click();

    await expect(phoneB).toHaveURL(new RegExp(`/s/${token}/printing$`));
    await expect(phoneB.getByRole("heading", { name: /Foto dalam/ })).toBeVisible();
    await expect(phoneB.getByRole("heading", { name: "Sesi Tidak Aktif" })).toHaveCount(0);

    kioskGuard.assertClean();
    guardA.assertClean();
    guardB.assertClean();
  } finally {
    await kioskContext.close();
    await phoneAContext.close();
    await phoneBContext.close();
  }
});
