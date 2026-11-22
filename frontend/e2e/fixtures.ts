import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APIRequestContext, expect, Locator, Page } from "@playwright/test";

export const E2E_BASE_URL = "http://127.0.0.1:8123";
export const E2E_ADMIN_PIN = process.env.ADMIN_INITIAL_PIN || "482910";
export const E2E_BASE_DIR = path.join(os.tmpdir(), "omah-ndog-e2e");
export const E2E_PHOTOS_ROOT = path.join(E2E_BASE_DIR, "e2e_photos");
export const E2E_SUBFOLDER = "sesi-e2e";
export const E2E_FRAME_PNG_PATH = path.join(E2E_BASE_DIR, "e2e_assets", "frame-4r.png");
export const E2E_PRINTER_STATE_PATH = path.join(E2E_BASE_DIR, "printer_state.json");
export const E2E_PRINTED_JOBS_PATH = path.join(E2E_BASE_DIR, "printed_jobs.jsonl");

export type MockPrinterMode = "ready" | "offline" | "paper_out" | "error";

export interface PrintedJobLogEntry {
  printer_name: string;
  copies: number;
  orientation: string;
  image_path: string;
  width: number;
  height: number;
  dpi: number[] | null;
}

export interface JpegInfo {
  width: number;
  height: number;
  dpiX: number | null;
  dpiY: number | null;
}

export interface PageErrorGuard {
  pageErrors: string[];
  consoleErrors: string[];
  assertClean: () => void;
}

export function attachErrorGuards(
  page: Page,
  options: { allowExpected410?: boolean } = {}
): PageErrorGuard {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (options.allowExpected410 && text.includes("410 (Gone)")) return;
    consoleErrors.push(text);
  });

  return {
    pageErrors,
    consoleErrors,
    assertClean() {
      expect(pageErrors, `Uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
      expect(consoleErrors, `Console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
    },
  };
}

export async function assertAllImagesLoaded(page: Page): Promise<void> {
  const images = page.locator("img");
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    if (!(await img.isVisible())) continue;
    await expect
      .poll(
        async () =>
          img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
        { timeout: 10_000 }
      )
      .toBe(true);
  }
}

export async function adminHeaders(
  request: APIRequestContext
): Promise<{ Authorization: string }> {
  const loginRes = await request.post("/api/admin/auth/login", {
    data: { pin: E2E_ADMIN_PIN },
  });
  expect(loginRes.ok()).toBe(true);
  const { token } = (await loginRes.json()) as { token: string };
  return { Authorization: `Bearer ${token}` };
}

export function setPrinterMode(mode: MockPrinterMode, message = ""): void {
  fs.mkdirSync(E2E_BASE_DIR, { recursive: true });
  const tmpPath = `${E2E_PRINTER_STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ mode, message }), "utf-8");
  fs.renameSync(tmpPath, E2E_PRINTER_STATE_PATH);
}

export function readPrintedJobs(): PrintedJobLogEntry[] {
  if (!fs.existsSync(E2E_PRINTED_JOBS_PATH)) return [];
  const content = fs.readFileSync(E2E_PRINTED_JOBS_PATH, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PrintedJobLogEntry);
}

export async function resetPrintState(request: APIRequestContext): Promise<void> {
  setPrinterMode("ready", "");
  fs.mkdirSync(E2E_BASE_DIR, { recursive: true });
  fs.writeFileSync(E2E_PRINTED_JOBS_PATH, "", "utf-8");

  const headers = await adminHeaders(request);
  const res = await request.put("/api/admin/settings", {
    headers,
    data: {
      auto_print_enabled: false,
      printer_name: "",
    },
  });
  expect(res.ok()).toBe(true);
}

export function readJpegInfo(buffer: Buffer): JpegInfo {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Invalid JPEG header");
  }

  let width = 0;
  let height = 0;
  let dpiX: number | null = null;
  let dpiY: number | null = null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset++;
    }
    if (offset >= buffer.length) break;

    const marker = buffer[offset];
    offset++;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) break;

    const segLen = buffer.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buffer.length) break;

    // APP0 JFIF
    if (
      marker === 0xe0 &&
      segLen >= 16 &&
      buffer.toString("ascii", offset + 2, offset + 7) === "JFIF\0"
    ) {
      const units = buffer[offset + 9];
      const rawX = buffer.readUInt16BE(offset + 10);
      const rawY = buffer.readUInt16BE(offset + 12);
      if (units === 1) {
        dpiX = rawX;
        dpiY = rawY;
      } else if (units === 2) {
        dpiX = Math.round(rawX * 2.54);
        dpiY = Math.round(rawY * 2.54);
      }
    }

    // SOF markers (excluding DHT=0xC4, JPG=0xC8, DAC=0xCC)
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segLen >= 7) {
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }

    offset += segLen;
  }

  return { width, height, dpiX, dpiY };
}

export async function loginAdminPage(page: Page): Promise<void> {
  await page.goto("/admin");
  const dashboardHeading = page.getByRole("heading", { name: "Admin Dashboard", exact: true });
  const pinInput = page.getByLabel("PIN Admin");
  await expect(dashboardHeading.or(pinInput)).toBeVisible({ timeout: 10_000 });
  if (await pinInput.isVisible()) {
    await pinInput.fill(E2E_ADMIN_PIN);
    await page.getByRole("button", { name: "Masuk" }).click();
  }
  await expect(dashboardHeading).toBeVisible({ timeout: 10_000 });
}

export function getJobCard(page: Page, jobId: number): Locator {
  return page
    .locator("strong", { hasText: new RegExp(`^#${jobId} ·`) })
    .locator("xpath=ancestor::div[3]");
}

export async function completeCustomerSelection(
  page: Page,
  options: { name?: string; copies?: number } = {}
): Promise<{ token: string }> {
  const customerName = options.name ?? "Customer E2E";
  const copies = options.copies ?? 1;

  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill(customerName);
  await page.getByLabel("Whatsapp", { exact: true }).fill("081234567890");
  await page.getByLabel("Email", { exact: true }).fill("customer@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "NEXT" }).click();

  await expect(page).toHaveURL(/\/s\/[^/]+\/qr$/);
  const match = page.url().match(/\/s\/([^/]+)\/qr$/);
  expect(match).not.toBeNull();
  const token = match![1];

  await page.getByRole("button", { name: "NEXT" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${token}/frame$`));
  await page.getByRole("button", { name: "Pilih Foto" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${token}/photo$`));
  const thumbs = page.locator('button img[src*="/thumb"]');
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(0).click();
  await thumbs.nth(1).click();
  await expect(page.getByText("2 / 2 slot terisi")).toBeVisible();
  await page.getByRole("button", { name: "Cetak", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${token}/preview$`));
  for (let i = 1; i < copies; i++) {
    await page.getByRole("button", { name: "Tambah jumlah cetak" }).click();
  }
  return { token };
}

export async function ensureStudioConfigured(request: APIRequestContext): Promise<void> {
  const headers = await adminHeaders(request);

  const settingsRes = await request.put("/api/admin/settings", {
    headers,
    data: {
      photo_root_dir: E2E_PHOTOS_ROOT,
      folder_mode: "active",
      active_subfolder: E2E_SUBFOLDER,
    },
  });
  expect(settingsRes.ok()).toBe(true);

  const catsRes = await request.get("/api/frames/categories");
  expect(catsRes.ok()).toBe(true);
  const cats = (await catsRes.json()) as Array<{ id: number; name: string }>;
  const cat4R = cats.find((c) => c.name === "4R") ?? cats[0];
  expect(cat4R).toBeTruthy();

  const framesRes = await request.get(`/api/frames?category_id=${cat4R.id}`);
  expect(framesRes.ok()).toBe(true);
  const frames = (await framesRes.json()) as Array<{ id: number; slots: unknown[] }>;
  const withTwoSlots = frames.find((f) => f.slots.length >= 2);
  if (withTwoSlots) return;

  const pngBuffer = fs.readFileSync(E2E_FRAME_PNG_PATH);
  const uploadRes = await request.post("/api/frames", {
    headers,
    multipart: {
      category_id: String(cat4R.id),
      name: "frame-4r-e2e",
      file: {
        name: "frame-4r.png",
        mimeType: "image/png",
        buffer: pngBuffer,
      },
    },
  });
  expect(uploadRes.ok()).toBe(true);
  const createdFrame = (await uploadRes.json()) as { id: number };

  const slotsRes = await request.put(`/api/frames/${createdFrame.id}/slots`, {
    headers,
    data: {
      slots: [
        { id: "slot-1", xPct: 10, yPct: 10, wPct: 38, hPct: 38, locked: false },
        { id: "slot-2", xPct: 52, yPct: 50, wPct: 38, hPct: 38, locked: false },
      ],
    },
  });
  expect(slotsRes.ok()).toBe(true);
}
