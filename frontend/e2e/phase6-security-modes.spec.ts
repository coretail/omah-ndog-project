import { expect, test } from "@playwright/test";
import {
  adminHeaders,
  attachErrorGuards,
  E2E_ADMIN_PIN,
  getCustomerHistorySection,
  getJobCard,
  getTunnelSection,
  loginAdminPage,
  resetPhase6State,
} from "./fixtures";

test.describe("Phase 6: Auth Failure, Tunnel Blocking, Multi-Device & URL Modes", () => {
  test.beforeEach(async ({ request }) => {
    await resetPhase6State(request);
  });

  test("returns cleanly to PIN login modal when admin session is invalidated (401)", async ({
    page,
    request,
  }) => {
    const guard = attachErrorGuards(page, { allowExpected401: true });
    await loginAdminPage(page);

    const token = await page.evaluate(() =>
      sessionStorage.getItem("omah_ndog_admin_session")
    );
    expect(token).toBeTruthy();

    // Simulate logout/session revocation from another tab
    const logoutRes = await request.post("/api/admin/auth/logout", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status()).toBe(200);

    const historySection = getCustomerHistorySection(page);
    await historySection.getByRole("button", { name: "Refresh" }).click();

    // UI recovers by showing PIN login modal instead of crashing
    const pinInput = page.getByLabel("PIN Admin");
    await expect(pinInput).toBeVisible({ timeout: 10_000 });
    await pinInput.fill(E2E_ADMIN_PIN);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(
      page.getByRole("heading", { name: "Admin Dashboard", exact: true })
    ).toBeVisible();

    guard.assertClean();
  });

  test("blocks admin customers, CSV export, and print queue endpoints when CF-Connecting-IP tunnel header is present (403)", async ({
    browser,
    request,
  }) => {
    const headers = await adminHeaders(request);

    for (const endpoint of [
      "/api/admin/customers",
      "/api/admin/customers/export.csv",
      "/api/prints/queue",
    ]) {
      const res = await request.get(endpoint, {
        headers: {
          ...headers,
          "CF-Connecting-IP": "203.0.113.42",
        },
      });
      expect(res.status(), `Expected 403 for ${endpoint}`).toBe(403);
    }

    const tunnelContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "CF-Connecting-IP": "203.0.113.42" },
    });
    const tunnelPage = await tunnelContext.newPage();
    const tunnelGuard = attachErrorGuards(tunnelPage, { allowExpected403: true });

    try {
      await tunnelPage.goto("/admin");
      await expect(
        tunnelPage.getByRole("heading", { name: "Akses Admin Dibatasi" })
      ).toBeVisible();
      await expect(
        tunnelPage.getByText("Access is blocked through external tunnels.")
      ).toBeVisible();
      tunnelGuard.assertClean();
    } finally {
      await tunnelContext.close();
    }
  });

  test("allows desktop Kiosk and mobile device to collaborate on the same session without corrupting state", async ({
    browser,
  }) => {
    const kioskContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const adminContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    const kioskPage = await kioskContext.newPage();
    const mobilePage = await mobileContext.newPage();
    const adminPage = await adminContext.newPage();

    const kioskGuard = attachErrorGuards(kioskPage);
    const mobileGuard = attachErrorGuards(mobilePage);
    const adminGuard = attachErrorGuards(adminPage);

    try {
      // Kiosk registers session
      await kioskPage.goto("/");
      await kioskPage.getByLabel("Name", { exact: true }).fill("Sesi Campuran");
      await kioskPage.getByLabel("Whatsapp", { exact: true }).fill("081255544433");
      await kioskPage.getByLabel("Email", { exact: true }).fill("campuran@example.com");
      await kioskPage.getByRole("checkbox").check();
      await kioskPage.getByRole("button", { name: "NEXT" }).click();

      await expect(kioskPage).toHaveURL(/\/s\/[^/]+\/qr$/);
      const match = kioskPage.url().match(/\/s\/([^/]+)\/qr$/);
      expect(match).not.toBeNull();
      const token = match![1];

      // Mobile opens the same session QR URL concurrently
      await mobilePage.goto(`/s/${token}`);
      await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/frame$`));

      // Kiosk selects photos 0 & 1 and 2 copies
      await kioskPage.getByRole("button", { name: "NEXT" }).click();
      await expect(kioskPage).toHaveURL(new RegExp(`/s/${token}/frame$`));
      await kioskPage.getByRole("button", { name: "Pilih Foto" }).click();
      const kioskThumbs = kioskPage.locator('button img[src*="/thumb"]');
      await expect(kioskThumbs).toHaveCount(3);
      await kioskThumbs.nth(0).click();
      await kioskThumbs.nth(1).click();
      await kioskPage.getByRole("button", { name: "Cetak", exact: true }).click();
      await expect(kioskPage).toHaveURL(new RegExp(`/s/${token}/preview$`));
      await kioskPage.getByRole("button", { name: "Tambah jumlah cetak" }).click();

      const kioskSubmitPromise = kioskPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
      );
      await kioskPage.getByRole("button", { name: "Cetak", exact: true }).click();
      const jobKiosk = ((await (await kioskSubmitPromise).json()) as { id: number }).id;

      // Mobile selects photos 1 & 2 and 1 copy independently
      await mobilePage.getByRole("button", { name: "Pilih Foto" }).click();
      const mobileThumbs = mobilePage.locator('button img[src*="/thumb"]');
      await expect(mobileThumbs).toHaveCount(3);
      await mobileThumbs.nth(1).click();
      await mobileThumbs.nth(2).click();
      await mobilePage.getByRole("button", { name: "Cetak", exact: true }).click();
      await expect(mobilePage).toHaveURL(new RegExp(`/s/${token}/preview$`));
      await expect(mobilePage.getByText("01", { exact: true })).toBeVisible();

      const mobileSubmitPromise = mobilePage.waitForResponse(
        (res) =>
          res.url().includes(`/api/prints/${token}`) && res.request().method() === "POST"
      );
      await mobilePage.getByRole("button", { name: "Cetak", exact: true }).click();
      const jobMobile = ((await (await mobileSubmitPromise).json()) as { id: number }).id;

      expect(jobKiosk).not.toBe(jobMobile);
      await expect(kioskPage.getByText("Menunggu Antrean Cetak")).toBeVisible();
      await expect(mobilePage.getByText("Menunggu Antrean Cetak")).toBeVisible();

      // Admin sees both jobs separately with accurate copy counts & totals
      await loginAdminPage(adminPage);
      const cardKiosk = getJobCard(adminPage, jobKiosk);
      const cardMobile = getJobCard(adminPage, jobMobile);
      await expect(cardKiosk).toBeVisible({ timeout: 15_000 });
      await expect(cardMobile).toBeVisible({ timeout: 15_000 });
      await expect(cardKiosk).toContainText("2 lbr");
      await expect(cardKiosk).toContainText("Rp 30.000");
      await expect(cardMobile).toContainText("1 lbr");
      await expect(cardMobile).toContainText("Rp 15.000");

      kioskGuard.assertClean();
      mobileGuard.assertClean();
      adminGuard.assertClean();
    } finally {
      await kioskContext.close();
      await mobileContext.close();
      await adminContext.close();
    }
  });

  test("switches QR URL between public tunnel mode and LAN fallback mode", async ({
    page,
  }) => {
    const guard = attachErrorGuards(page);
    await loginAdminPage(page);

    const tunnelSection = getTunnelSection(page);
    const urlInput = tunnelSection.locator('input[type="url"]');
    await urlInput.fill("https://studio.omahndog.test");
    await tunnelSection.getByRole("button", { name: "Simpan URL" }).click();
    await expect(page.getByText("Pengaturan URL Tunnel tersimpan.")).toBeVisible();

    // Register customer in Tunnel mode
    await page.goto("/");
    await page.getByLabel("Name", { exact: true }).fill("Customer Tunnel");
    await page.getByLabel("Whatsapp", { exact: true }).fill("081211122233");
    await page.getByLabel("Email", { exact: true }).fill("tunnel@example.com");
    await page.getByRole("checkbox").check();

    const tunnelSessPromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/sessions") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "NEXT" }).click();
    const tunnelSess = (await (await tunnelSessPromise).json()) as {
      token: string;
      qr_mode: string;
      qr_target_url: string;
    };
    expect(tunnelSess.qr_mode).toBe("tunnel");
    expect(tunnelSess.qr_target_url).toBe(
      `https://studio.omahndog.test/s/${tunnelSess.token}`
    );
    await expect(page.getByText("Mode Tunnel Publik")).toBeVisible();
    await expect(page.getByText(tunnelSess.qr_target_url)).toBeVisible();

    // Clear public_base_url to return to LAN fallback mode
    await loginAdminPage(page);
    await tunnelSection.locator('input[type="url"]').fill("");
    await tunnelSection.getByRole("button", { name: "Simpan URL" }).click();
    await expect(page.getByText("Pengaturan URL Tunnel tersimpan.")).toBeVisible();

    await page.goto("/");
    await page.getByLabel("Name", { exact: true }).fill("Customer LAN");
    await page.getByLabel("Whatsapp", { exact: true }).fill("081244455566");
    await page.getByLabel("Email", { exact: true }).fill("lan@example.com");
    await page.getByRole("checkbox").check();

    const lanSessPromise = page.waitForResponse(
      (res) => res.url().endsWith("/api/sessions") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "NEXT" }).click();
    const lanSess = (await (await lanSessPromise).json()) as {
      token: string;
      qr_mode: string;
      qr_target_url: string;
    };
    expect(lanSess.qr_mode).toBe("lan");
    expect(lanSess.qr_target_url).toMatch(
      new RegExp(`^http://[^/]+:8123/s/${lanSess.token}$`)
    );
    await expect(page.getByText("Mode Wi-Fi Studio (LAN)")).toBeVisible();
    await expect(page.getByText(lanSess.qr_target_url)).toBeVisible();

    guard.assertClean();
  });
});
