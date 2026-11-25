import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const TUNNEL_URL = (process.env.TUNNEL_URL || "").replace(/\/+$/, "");
const ADMIN_PIN = process.env.ADMIN_PIN || "123456";
const OUT_DIR = path.resolve("..", "screenshots", "showcase");

assert(
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(TUNNEL_URL),
  `TUNNEL_URL must be a valid https://*.trycloudflare.com URL, got: "${TUNNEL_URL}"`
);

fs.mkdirSync(OUT_DIR, { recursive: true });

function attachGuards(page, { allow404 = false } = {}) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (allow404 && text.includes("404")) return;
    consoleErrors.push(text);
  });
  return {
    assertClean(label) {
      assert.deepEqual(pageErrors, [], `[${label}] pageErrors: ${pageErrors.join(" | ")}`);
      assert.deepEqual(consoleErrors, [], `[${label}] consoleErrors: ${consoleErrors.join(" | ")}`);
    },
  };
}

async function installPrinterSafetyRoute(contextOrPage) {
  await contextOrPage.route("**/api/prints/queue/*/print", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        status: "printed",
        error_message: "",
        mocked: true,
      }),
    });
  });
  await contextOrPage.route("**/api/prints/queue/*/retry", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        status: "printed",
        error_message: "",
        mocked: true,
      }),
    });
  });
}

async function waitForPageReady(page) {
  await page.evaluate(() => document.fonts.ready);
  const imgs = page.locator("img");
  const count = await imgs.count();
  for (let i = 0; i < count; i++) {
    const img = imgs.nth(i);
    if (!(await img.isVisible())) continue;
    await page.waitForFunction(
      (el) => el.complete && el.naturalWidth > 0,
      await img.elementHandle(),
      { timeout: 15_000 }
    );
  }
  await page.waitForTimeout(400);
}

async function snap(page, filename, { fullPage = false } = {}) {
  const target = path.join(OUT_DIR, filename);
  await waitForPageReady(page);
  await page.screenshot({ path: target, fullPage, type: "png" });
  console.log(`Captured: ${filename}`);
}

async function verifySettingsPrecondition() {
  const loginRes = await fetch(`${BASE_URL}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: ADMIN_PIN }),
  });
  assert.equal(loginRes.status, 200, `Admin login failed: ${loginRes.status}`);
  const { token } = await loginRes.json();

  const settingsRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(settingsRes.status, 200, `Get settings failed: ${settingsRes.status}`);
  const settings = await settingsRes.json();
  assert.equal(
    settings.auto_print_enabled,
    false,
    "auto_print_enabled MUST be false to prevent physical printing!"
  );
  assert.equal(
    settings.public_base_url,
    TUNNEL_URL,
    `public_base_url (${settings.public_base_url}) must match TUNNEL_URL (${TUNNEL_URL})`
  );
  return token;
}

async function waitForJobOutputReady(adminToken, jobId) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${BASE_URL}/api/prints/queue`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const jobs = await res.json();
    const job = jobs.find((j) => j.id === jobId);
    if (job && job.has_output) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for job #${jobId} 300 DPI output`);
}

async function main() {
  const adminToken = await verifySettingsPrecondition();
  const browser = await chromium.launch({ headless: true });

  let sessionToken = "";
  let submittedJobId = 0;

  try {
    // 1. Desktop Kiosk Flow
    const kioskCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await installPrinterSafetyRoute(kioskCtx);
    const kioskPage = await kioskCtx.newPage();
    const kioskGuard = attachGuards(kioskPage);

    // 01-kiosk-home.png
    await kioskPage.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await kioskPage.getByRole("heading", { name: /Halo Kaka/i }).waitFor({ state: "visible" });
    await snap(kioskPage, "01-kiosk-home.png");

    await kioskPage.getByLabel("Name", { exact: true }).fill("Raka Pratama");
    await kioskPage.getByLabel("Whatsapp", { exact: true }).fill("081234567890");
    await kioskPage.getByLabel("Email", { exact: true }).fill("raka.pratama@example.com");
    await kioskPage.getByRole("checkbox").check();
    await kioskPage.getByRole("button", { name: "NEXT" }).click();

    await kioskPage.waitForURL(/\/s\/[^/]+\/qr$/);
    const match = kioskPage.url().match(/\/s\/([^/]+)\/qr$/);
    assert(match, "Failed to extract session token from URL");
    sessionToken = decodeURIComponent(match[1]);

    // 04-qr-handoff.png
    await kioskPage.getByText("4 foto siap dipilih (sesi-showcase)").waitFor({ state: "visible" });
    await kioskPage.getByText("Mode Tunnel Publik").waitFor({ state: "visible" });
    await kioskPage.getByText(TUNNEL_URL).waitFor({ state: "visible" });
    await snap(kioskPage, "04-qr-handoff.png");

    await kioskPage.getByRole("button", { name: "NEXT" }).click();
    await kioskPage.waitForURL(new RegExp(`/s/${encodeURIComponent(sessionToken)}/frame$`));

    // 03-frame-preview.png
    await kioskPage.getByRole("heading", { name: "Pilih Frame" }).waitFor({ state: "visible" });
    // Test switching category to Polaroid and back to 4R
    await kioskPage.getByRole("button", { name: "Polaroid", exact: true }).click();
    await kioskPage.getByRole("button", { name: /Retro Polaroid Single/i }).waitFor({ state: "visible" });
    await kioskPage.getByRole("button", { name: "4R", exact: true }).click();
    await kioskPage.getByRole("button", { name: /Omah Ndog Grid 4-Slot/i }).click();
    await snap(kioskPage, "03-frame-preview.png", { fullPage: true });

    await kioskPage.getByRole("button", { name: "Pilih Foto" }).click();
    await kioskPage.waitForURL(new RegExp(`/s/${encodeURIComponent(sessionToken)}/photo$`));

    // 02-photo-selection.png
    await kioskPage.getByRole("heading", { name: "Pilih Foto" }).waitFor({ state: "visible" });
    const thumbs = kioskPage.locator('button img[src*="/thumb"]');
    await thumbs.nth(3).waitFor({ state: "visible" });
    assert.equal(await thumbs.count(), 4, "Expected 4 photos from photo-example");
    for (let i = 0; i < 4; i++) {
      await thumbs.nth(i).click();
    }
    await kioskPage.getByText("4 / 4 slot terisi").waitFor({ state: "visible" });
    await kioskPage.getByText("Atur Slot Aktif").waitFor({ state: "visible" });
    await snap(kioskPage, "02-photo-selection.png", { fullPage: true });

    await kioskPage.getByRole("button", { name: "Cetak", exact: true }).click();
    await kioskPage.waitForURL(new RegExp(`/s/${encodeURIComponent(sessionToken)}/preview$`));

    // 11-last-preview.png
    await kioskPage.getByRole("heading", { name: "Last Preview" }).waitFor({ state: "visible" });
    await kioskPage.getByRole("button", { name: "Tambah jumlah cetak" }).click();
    await kioskPage.getByText("Rp 30.000").waitFor({ state: "visible" });
    await snap(kioskPage, "11-last-preview.png", { fullPage: true });

    const [printResp] = await Promise.all([
      kioskPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/prints/${encodeURIComponent(sessionToken)}`) &&
          res.request().method() === "POST"
      ),
      kioskPage.getByRole("button", { name: "Cetak", exact: true }).click(),
    ]);
    assert.equal(printResp.status(), 201, `Expected 201 on print submit, got ${printResp.status()}`);
    const printBody = await printResp.json();
    assert.equal(printBody.status, "queued");
    assert.equal(printBody.copies, 2);
    submittedJobId = printBody.id;

    // 06-print-confirmation.png
    await kioskPage.waitForURL(new RegExp(`/s/${encodeURIComponent(sessionToken)}/printing$`));
    await kioskPage.getByRole("heading", { name: /Foto dalam\s*Proses Cetak/i }).waitFor({ state: "visible" });
    await kioskPage.getByText("Menunggu Antrean Cetak").waitFor({ state: "visible" });
    await snap(kioskPage, "06-print-confirmation.png");

    await waitForJobOutputReady(adminToken, submittedJobId);
    kioskGuard.assertClean("kiosk");
    await kioskCtx.close();

    // 2. Mobile Flow via Live Cloudflare Tunnel
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await installPrinterSafetyRoute(mobileCtx);
    const mobilePage = await mobileCtx.newPage();
    const mobileGuard = attachGuards(mobilePage);

    await mobilePage.goto(`${TUNNEL_URL}/s/${encodeURIComponent(sessionToken)}`, {
      waitUntil: "networkidle",
    });
    await mobilePage.waitForURL(/\/s\/[^/]+\/frame$/);
    await mobilePage.getByRole("heading", { name: "Pilih Frame" }).waitFor({ state: "visible" });
    await mobilePage.getByRole("button", { name: /Omah Ndog Classic 2-Slot/i }).click();
    await snap(mobilePage, "12-mobile-frame-selection.png", { fullPage: true });

    await mobilePage.getByRole("button", { name: "Pilih Foto" }).click();
    await mobilePage.waitForURL(/\/s\/[^/]+\/photo$/);
    const mThumbs = mobilePage.locator('button img[src*="/thumb"]');
    await mThumbs.nth(3).waitFor({ state: "visible" });
    await mThumbs.nth(0).click();
    await mThumbs.nth(1).click();
    await mobilePage.getByText("2 / 2 slot terisi").waitFor({ state: "visible" });
    await snap(mobilePage, "05-mobile-selection.png", { fullPage: true });

    mobileGuard.assertClean("mobile-tunnel");
    await mobileCtx.close();

    // 3. Admin Dashboard Flow (Desktop 1440x900)
    const adminCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      acceptDownloads: true,
    });
    await installPrinterSafetyRoute(adminCtx);
    const adminPage = await adminCtx.newPage();
    const adminGuard = attachGuards(adminPage);

    // 07-admin-login.png
    await adminPage.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await adminPage.getByRole("heading", { name: "Masuk Admin Dashboard" }).waitFor({ state: "visible" });
    await adminPage.getByLabel("PIN Admin").waitFor({ state: "visible" });
    await snap(adminPage, "07-admin-login.png");

    await adminPage.getByLabel("PIN Admin").fill(ADMIN_PIN);
    await adminPage.getByRole("button", { name: "Masuk" }).click();
    await adminPage.getByRole("heading", { name: "Admin Dashboard", exact: true }).waitFor({ state: "visible" });
    await adminPage.getByText("Omah Ndog Grid 4-Slot").first().waitFor({ state: "visible" });

    // 08-admin-dashboard.png
    await adminPage.evaluate(() => window.scrollTo(0, 0));
    await snap(adminPage, "08-admin-dashboard.png");

    // 09-admin-frame-editor.png
    await adminPage.getByText(/Omah Ndog Grid 4-Slot/i).first().click();
    await adminPage.getByText("Dimensi: 1200×1800px").waitFor({ state: "visible" });
    await adminPage.getByText("Total Slot: 4").waitFor({ state: "visible" });
    await adminPage.getByText("#1").first().click();
    const frameSection = adminPage.getByRole("heading", { name: "Frame Setting" }).locator("xpath=ancestor::section[1]");
    await frameSection.scrollIntoViewIfNeeded();
    await snap(adminPage, "09-admin-frame-editor.png");

    // 14-admin-photo-settings.png
    const photoSection = adminPage.getByRole("heading", { name: "Photo File" }).locator("xpath=ancestor::section[1]");
    await photoSection.scrollIntoViewIfNeeded();
    await photoSection.getByLabel("Subfolder Aktif:").waitFor({ state: "visible" });
    assert.equal(await photoSection.getByLabel("Subfolder Aktif:").inputValue(), "sesi-showcase");
    await snap(adminPage, "14-admin-photo-settings.png");

    // 13-admin-print-queue.png
    const queueSection = adminPage.getByRole("heading", { name: /Print Queue/i }).locator("xpath=ancestor::section[1]");
    await queueSection.scrollIntoViewIfNeeded();
    await adminPage.getByText(`#${submittedJobId} · Raka Pratama`).waitFor({ state: "visible" });
    await adminPage.getByRole("button", { name: "Print Sekarang" }).first().waitFor({ state: "visible" });
    await snap(adminPage, "13-admin-print-queue.png");

    // 10-admin-settings-export.png
    const historySection = adminPage
      .getByRole("heading", { name: "Privasi, Retensi & Histori Customer" })
      .locator("xpath=ancestor::section[1]");
    const tunnelSection = adminPage
      .getByRole("heading", { name: "Pengaturan Tunnel & Sistem" })
      .locator("xpath=ancestor::section[1]");
    await tunnelSection.scrollIntoViewIfNeeded();
    await adminPage.getByText("Raka Pratama").last().waitFor({ state: "visible" });

    // Verify CSV export download
    const [download] = await Promise.all([
      adminPage.waitForEvent("download"),
      historySection.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "studio_customers.csv");
    const csvPath = await download.path();
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    assert(csvContent.includes("Raka Pratama"), "Exported CSV must contain Raka Pratama");

    await historySection.scrollIntoViewIfNeeded();
    await snap(adminPage, "10-admin-settings-export.png");

    adminGuard.assertClean("admin");
    await adminCtx.close();

    // 4. Extra route: Session Unavailable (invalid token)
    const errCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const errPage = await errCtx.newPage();
    const errGuard = attachGuards(errPage, { allow404: true });
    await errPage.goto(`${BASE_URL}/s/invalid-token-showcase/frame`, { waitUntil: "networkidle" });
    await errPage.getByText(/Session not found|Sesi tidak ditemukan/i).waitFor({ state: "visible" });
    await snap(errPage, "15-session-unavailable.png");
    errGuard.assertClean("session-unavailable");
    await errCtx.close();

    console.log("ALL_SHOWCASE_TESTS_PASSED");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("SHOWCASE_FAILED:", err);
  process.exit(1);
});
