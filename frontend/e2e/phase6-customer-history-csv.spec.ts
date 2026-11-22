import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  adminHeaders,
  attachErrorGuards,
  getCustomerHistorySection,
  getDefaultTwoSlotFrame,
  loginAdminPage,
  parseCsv,
  resetPhase6State,
  runDbHelper,
  setPrinterMode,
} from "./fixtures";

const FORMULA_PAYLOADS = [
  "=SUM(A1)",
  "+628111",
  "-1+1",
  "@IMPORT",
  "\tcmd",
  "\rcmd",
  "   =1+1",
];

test.describe("Phase 6: Customer History, Printed-Only Totals, Pagination & CSV Export", () => {
  test.beforeEach(async ({ request }) => {
    await resetPhase6State(request);
  });

  test("displays printed-only total_spent while job_count includes all jobs", async ({
    page,
    request,
  }) => {
    const guard = attachErrorGuards(page);
    const headers = await adminHeaders(request);
    const frame = await getDefaultTwoSlotFrame(request);

    // Create customer session
    const sessRes = await request.post("/api/sessions", {
      data: {
        name: "Ayu Cetak",
        whatsapp: "081234567890",
        email: "ayu@example.com",
        consent_accepted: true,
      },
    });
    expect(sessRes.status()).toBe(201);
    const { token } = (await sessRes.json()) as { token: string };

    const selectedPhotos = [
      { slotId: frame.slotIds[0], filename: "photo_1.jpg", offsetX: 0, offsetY: 0, zoom: 1 },
      { slotId: frame.slotIds[1], filename: "photo_2.jpg", offsetX: 0, offsetY: 0, zoom: 1 },
    ];

    // Job 1: 2 copies -> printed
    const j1Res = await request.post(`/api/prints/${token}`, {
      data: { frame_id: frame.id, copies: 2, selected_photos: selectedPhotos },
    });
    expect(j1Res.status()).toBe(201);
    const { id: job1Id } = (await j1Res.json()) as { id: number };

    await expect
      .poll(
        async () => {
          const q = await request.get("/api/prints/queue", { headers });
          const list = (await q.json()) as Array<{ id: number; has_output: boolean }>;
          return list.find((item) => item.id === job1Id)?.has_output ?? false;
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    expect(
      (await request.post(`/api/prints/queue/${job1Id}/print`, { headers })).status()
    ).toBe(200);

    await expect
      .poll(
        async () => {
          const st = await request.get(`/api/prints/${token}/${job1Id}`);
          return ((await st.json()) as { status: string }).status;
        },
        { timeout: 15_000 }
      )
      .toBe("printed");

    // Job 2: 3 copies -> failed (must NOT count toward total_spent)
    setPrinterMode("error", "Simulasi printer error");
    const j2Res = await request.post(`/api/prints/${token}`, {
      data: { frame_id: frame.id, copies: 3, selected_photos: selectedPhotos },
    });
    expect(j2Res.status()).toBe(201);
    const { id: job2Id } = (await j2Res.json()) as { id: number };

    await expect
      .poll(
        async () => {
          const q = await request.get("/api/prints/queue", { headers });
          const list = (await q.json()) as Array<{ id: number; has_output: boolean }>;
          return list.find((item) => item.id === job2Id)?.has_output ?? false;
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    expect(
      (await request.post(`/api/prints/queue/${job2Id}/print`, { headers })).status()
    ).toBe(200);

    await expect
      .poll(
        async () => {
          const st = await request.get(`/api/prints/${token}/${job2Id}`);
          return ((await st.json()) as { status: string }).status;
        },
        { timeout: 15_000 }
      )
      .toBe("failed");

    setPrinterMode("ready", "");

    // Verify in Admin UI table
    await loginAdminPage(page);
    const historySection = getCustomerHistorySection(page);
    await expect(
      historySection.getByRole("columnheader", { name: "Total Tercetak" })
    ).toBeVisible();

    const row = historySection.locator("tbody tr", { hasText: "Ayu Cetak" });
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").nth(4)).toHaveText("2");
    await expect(row.locator("td").nth(5)).toHaveText("Rp 30.000");

    guard.assertClean();
  });

  test("paginates >500 customers without duplicates and exports complete formula-sanitized CSV with disabled button during download", async ({
    page,
  }) => {
    const guard = attachErrorGuards(page);

    runDbHelper([
      "seed-bulk-customers",
      "520",
      "--payloads-json",
      JSON.stringify(FORMULA_PAYLOADS),
    ]);

    await loginAdminPage(page);
    const historySection = getCustomerHistorySection(page);
    const rows = historySection.locator("tbody tr");

    await expect(historySection.getByText("Menampilkan 100 dari 520 customer")).toBeVisible();
    await expect(rows).toHaveCount(100);

    await historySection.getByRole("button", { name: "Muat Lebih Banyak" }).click();
    await expect(historySection.getByText("Menampilkan 200 dari 520 customer")).toBeVisible();
    await expect(rows).toHaveCount(200);

    const rowTexts = await rows.allInnerTexts();
    expect(new Set(rowTexts).size).toBe(200);

    // Intercept CSV export to deterministically observe disabled state during download
    let releaseCsv!: () => void;
    const csvGate = new Promise<void>((resolve) => {
      releaseCsv = resolve;
    });

    await page.route("**/api/admin/customers/export.csv", async (route) => {
      const response = await route.fetch();
      await csvGate;
      await route.fulfill({ response });
    });

    const exportBtn = historySection.getByRole("button", { name: /Export CSV|Mengekspor/ });
    const downloadPromise = page.waitForEvent("download");
    await exportBtn.click();

    await expect(exportBtn).toBeDisabled();
    await expect(exportBtn).toHaveText("Mengekspor...");

    releaseCsv();
    const download = await downloadPromise;
    await expect(exportBtn).toBeEnabled();
    await expect(exportBtn).toHaveText("Export CSV");

    expect(download.suggestedFilename()).toBe("studio_customers.csv");
    const csvPath = await download.path();
    expect(csvPath).not.toBeNull();
    const rawBuf = fs.readFileSync(csvPath!);

    // Verify UTF-8 BOM (EF BB BF)
    expect(rawBuf[0]).toBe(0xef);
    expect(rawBuf[1]).toBe(0xbb);
    expect(rawBuf[2]).toBe(0xbf);

    const csvText = rawBuf.subarray(3).toString("utf-8");
    const parsedRows = parseCsv(csvText).filter((r) => r.length > 1 || r[0] !== "");
    expect(parsedRows).toHaveLength(521); // 1 header + 520 customers

    const header = parsedRows[0];
    expect(header).toContain("Total Tercetak (Rp)");
    const nameColIdx = header.indexOf("Name");
    expect(nameColIdx).toBeGreaterThanOrEqual(0);

    const exportedNames = new Set(parsedRows.slice(1).map((r) => r[nameColIdx]));
    for (const payload of FORMULA_PAYLOADS) {
      expect(exportedNames.has(`'${payload}`), `Missing sanitized payload: ${payload}`).toBe(true);
    }

    guard.assertClean();
  });
});
