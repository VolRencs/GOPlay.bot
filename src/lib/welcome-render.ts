import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ImageInfo,
  NormalizeImageOptions,
  NormalizedImage,
  WelcomeRenderer,
} from "welcome-render";

const PACKAGE = "welcome-render";
const importModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("welcome-render")>;
const moduleFontDir = resolve(import.meta.dirname ?? process.cwd(), "../../public/fonts");
const cwdFontDir = resolve(process.cwd(), "public/fonts");
const fontDir = existsSync(join(moduleFontDir, "Onest-Regular.ttf")) ? moduleFontDir : cwdFontDir;
const regularFont = join(fontDir, "Onest-Regular.ttf");
const boldFont = join(fontDir, "Onest-Bold.ttf");

let modulePromise: Promise<typeof import("welcome-render")> | undefined;
let rendererPromise: Promise<WelcomeRenderer> | undefined;
let unavailableUntil = 0;
let unavailableError: unknown;
let normalizeActive = 0;
const normalizeQueue: (() => void)[] = [];

async function withNormalizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (normalizeActive >= 1) await new Promise<void>((resolve) => normalizeQueue.push(resolve));
  else normalizeActive++;
  try {
    return await fn();
  } finally {
    normalizeActive--;
    const next = normalizeQueue.shift();
    if (next) { normalizeActive++; next(); }
  }
}

export async function welcomeRenderModule(): Promise<typeof import("welcome-render")> {
  if (modulePromise) return modulePromise;
  modulePromise = importModule(PACKAGE).catch((error: unknown) => {
    modulePromise = undefined;
    throw error;
  });
  return modulePromise;
}

export function getWelcomeRenderer(): Promise<WelcomeRenderer> {
  if (rendererPromise) return rendererPromise;
  if (Date.now() < unavailableUntil) {
    return Promise.reject(unavailableError ?? new Error("welcome-render is unavailable"));
  }
  if (!existsSync(regularFont)) {
    unavailableUntil = Date.now() + 60_000;
    unavailableError = new Error(`welcome font is missing: ${regularFont}`);
    return Promise.reject(unavailableError);
  }
  rendererPromise = welcomeRenderModule()
    .then(({ WelcomeRenderer }) =>
      WelcomeRenderer.fromFiles({
        regular: regularFont,
        ...(existsSync(boldFont) ? { bold: boldFont } : {}),
        systemFonts: true,
        cacheBytes: 32 * 1024 * 1024,
        maxDimension: 2560,
        maxPixels: 8 * 1024 * 1024,
      }),
    )
    .catch((error: unknown) => {
      rendererPromise = undefined;
      unavailableUntil = Date.now() + 60_000;
      unavailableError = error;
      throw error;
    });
  return rendererPromise;
}

export function normalizeWelcomeImage(
  data: Buffer,
  options: NormalizeImageOptions,
): Promise<NormalizedImage> {
  return withNormalizeSlot(async () => {
    const { normalizeImage } = await welcomeRenderModule();
    return normalizeImage(data, options);
  });
}

export async function probeWelcomeImage(data: Buffer): Promise<ImageInfo> {
  const { probeImage } = await welcomeRenderModule();
  return probeImage(data);
}
