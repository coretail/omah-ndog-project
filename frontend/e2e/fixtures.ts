import os from "node:os";
import path from "node:path";
import { APIRequestContext, expect, Page } from "@playwright/test";

export const E2E_BASE_URL = "http://127.0.0.1:8123";
export const E2E_ADMIN_PIN = process.env.ADMIN_INITIAL_PIN || "482910";
export const E2E_BASE_DIR = path.join(os.tmpdir(), "omah-ndog-e2e");
export const E2E_PHOTOS_ROOT = path.join(E2E_BASE_DIR, "e2e_photos");
export const E2E_SUBFOLDER = "sesi-e2e";
export const E2E_FRAME_PNG_PATH = path.join(E2E_BASE_DIR, "e2e_assets", "frame-4r.png");

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
    // Forward-compatible Fase 4 submitJob/getJobStatus returns 404 before Fase 5 mounts /api/prints
    if (text.includes("404 (Not Found)")) return;
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

export async function ensureStudioConfigured(request: APIRequestContext): Promise<void> {
  const loginRes = await request.post("/api/admin/auth/login", {
    data: { pin: E2E_ADMIN_PIN },
  });
  expect(loginRes.ok()).toBe(true);
  const { token } = (await loginRes.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };

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

  const fs = await import("node:fs");
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
