import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertAllImagesLoaded,
  attachErrorGuards,
  E2E_ADMIN_PIN,
  E2E_FRAME_PNG_PATH,
  E2E_PHOTOS_ROOT,
  E2E_SUBFOLDER,
} from "./fixtures";

test("Admin setup and full 7-screen Kiosk flow at 1920x1080", async ({ page, request }) => {
  const realDbPath = path.resolve(process.cwd(), "..", "data", "studio.db");
  const realDbMtimeBefore = fs.existsSync(realDbPath) ? fs.statSync(realDbPath).mtimeMs : null;

  // Smoke check backend health & Figma static assets
  const healthRes = await request.get("/api/health");
  expect(healthRes.status()).toBe(200);
  const health = (await healthRes.json()) as { status: string; database_journal_mode: string };
  expect(health.status).toBe("ok");
  expect(health.database_journal_mode).toBe("wal");

  for (const assetPath of [
    "/assets/bg-welcome.png",
    "/assets/hero-welcome.png",
    "/assets/bg-studio.png",
    "/assets/bg-admin.png",
  ]) {
    const assetRes = await request.get(assetPath);
    expect(assetRes.status(), `Missing static asset ${assetPath}`).toBe(200);
  }

  const guard = attachErrorGuards(page, { allowExpected410: true });

  // 1. Admin Setup via Settings icon
  await page.goto("/");
  await assertAllImagesLoaded(page);
  await page.getByRole("button", { name: "Pengaturan Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByLabel("PIN Admin").fill(E2E_ADMIN_PIN);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "4R", exact: true }).click();
  await page.locator('input[type="file"][accept="image/png"]').setInputFiles(E2E_FRAME_PNG_PATH);
  await expect(page.getByText("frame-4r (0 slot)")).toBeVisible();

  // Add 2 photo slots and drag slot #2
  await page.getByTitle("Tambah Slot Foto").click();
  await page.getByTitle("Tambah Slot Foto").click();
  const slot2 = page.locator("span", { hasText: /^#2/ }).locator("..");
  await expect(slot2).toBeVisible();
  const box = await slot2.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 80, { steps: 8 });
    await page.mouse.up();
  }

  await page.getByTitle("Simpan Koordinat Slot").click();
  await expect(page.getByText('Slot untuk "frame-4r" tersimpan.')).toBeVisible();
  await expect(page.getByText("frame-4r (2 slot)")).toBeVisible();

  // Configure dedicated photo root & active subfolder
  await page.getByPlaceholder("Contoh: D:\\StudioPhotos").fill(E2E_PHOTOS_ROOT);
  await page.getByTitle("Simpan Folder").click();
  await expect(page.getByText("Pengaturan folder foto tersimpan.")).toBeVisible();

  await page.getByLabel(/Subfolder Aktif:/).selectOption(E2E_SUBFOLDER);
  await page.getByTitle("Simpan Folder").click();
  await expect(page.getByText("Pengaturan folder foto tersimpan.")).toBeVisible();

  await page.getByRole("button", { name: "Kiosk" }).click();
  await expect(page).toHaveURL(/\/$/);

  // 2. Welcome Page (Group 14): enforce consent validation then submit
  await page.getByLabel("Name", { exact: true }).fill("Kaka Kiosk");
  await page.getByLabel("Whatsapp", { exact: true }).fill("081234567890");
  await page.getByLabel("Email", { exact: true }).fill("kaka@example.com");
  await page.getByRole("button", { name: "NEXT" }).click();
  await expect(page.getByRole("alert")).toContainText("Centang persetujuan privasi");
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "NEXT" }).click();

  // 3. QR Screen (Group 15)
  await expect(page).toHaveURL(/\/s\/[^/]+\/qr$/);
  const sessionTokenMatch = page.url().match(/\/s\/([^/]+)\/qr$/);
  expect(sessionTokenMatch).not.toBeNull();
  const sessionToken = sessionTokenMatch![1];

  await expect(
    page.getByText("Scan QR buat memilih Frame, dan Foto dari HP kalian masing masing")
  ).toBeVisible();
  await expect(page.getByText("3 foto siap dipilih (sesi-e2e)")).toBeVisible();
  await assertAllImagesLoaded(page);
  await page.getByRole("button", { name: "NEXT" }).click();

  // 4. Pilih Frame
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/frame$`));
  await expect(page.getByText("Rp 15.000 / lbr")).toBeVisible();
  await page.getByRole("button", { name: /frame-4r/i }).click();
  await expect(page.getByText("Slot 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Slot 2", { exact: true })).toBeVisible();
  await assertAllImagesLoaded(page);
  await page.getByRole("button", { name: "Pilih Foto" }).click();

  // 5. Pilih Foto
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/photo$`));
  const thumbs = page.locator('button img[src*="/thumb"]');
  await expect(thumbs).toHaveCount(3);
  await assertAllImagesLoaded(page);
  await expect(page.getByText("0 / 2 slot terisi")).toBeVisible();
  const cetakBtnPhoto = page.getByRole("button", { name: "Cetak", exact: true });
  await expect(cetakBtnPhoto).toBeDisabled();

  await thumbs.nth(0).click();
  await thumbs.nth(1).click();
  await expect(page.getByText("2 / 2 slot terisi")).toBeVisible();
  await expect(cetakBtnPhoto).toBeEnabled();

  await page.getByLabel(/Zoom/).fill("1.5");
  await expect(page.getByText("Zoom (1.5×)")).toBeVisible();
  await page.getByLabel("Geser Kiri/Kanan").fill("0.25");
  await cetakBtnPhoto.click();

  // 6. Last Preview
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/preview$`));
  await expect(
    page.getByText(
      "Jumlah foto yang dicetak, berarti menggunakan design dan layout yang sama dengan yang sudah di setup"
    )
  ).toBeVisible();
  await assertAllImagesLoaded(page);

  await page.getByRole("button", { name: "Tambah jumlah cetak" }).click();
  await expect(page.getByText("02", { exact: true })).toBeVisible();
  await expect(page.getByText("Rp 30.000")).toBeVisible();
  await page.getByRole("button", { name: "Cetak", exact: true }).click();

  // 7. Last Page (Printing): test Cetak lagi reset then Selesai
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/printing$`));
  await expect(page.getByRole("heading", { name: /Foto dalam/ })).toBeVisible();
  await page.getByRole("button", { name: "Cetak lagi" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/frame$`));
  await page.getByRole("button", { name: /frame-4r/i }).click();
  await page.getByRole("button", { name: "Pilih Foto" }).click();
  await expect(page.getByText("0 / 2 slot terisi")).toBeVisible();

  await thumbs.nth(1).click();
  await thumbs.nth(2).click();
  await page.getByRole("button", { name: "Cetak", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/preview$`));
  await page.getByRole("button", { name: "Cetak", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionToken}/printing$`));

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Selesai" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Completed QR URL is now rejected
  await page.goto(`/s/${sessionToken}/frame`);
  await expect(page.getByRole("heading", { name: "Sesi Tidak Aktif" })).toBeVisible();

  // Confirm real production data/studio.db was untouched
  const realDbMtimeAfter = fs.existsSync(realDbPath) ? fs.statSync(realDbPath).mtimeMs : null;
  expect(realDbMtimeAfter).toBe(realDbMtimeBefore);

  guard.assertClean();
});
