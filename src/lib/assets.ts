import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filenameFromUrl } from "./uploads.ts";

const imageMimeTypes: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function extMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
}

export class AssetError extends Error {}

export type StoredAsset<T extends string> = { target: T; filename: string; file: File; bytes: Buffer };
type OriginalAsset<T extends string> = { target: T; url: string };

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "image";

function extMatchesMime(filename: string, mime: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (mime === "image/png") return ext === "png";
  if (mime === "image/jpeg") return ext === "jpg" || ext === "jpeg";
  if (mime === "image/webp") return ext === "webp";
  if (mime === "image/gif") return ext === "gif";
  return false;
}

export async function collectNewUploads<T extends string>(form: FormData | null, specs: readonly { formKey: string; target: T }[], setAsset: (target: T, url: string) => void): Promise<StoredAsset<T>[]> {
  const assets: StoredAsset<T>[] = [];
  for (const { formKey, target } of specs) {
    const file = form?.get(formKey);
    if (!(file instanceof File)) continue;
    if (!imageMimeTypes.includes(file.type) || file.size > MAX_UPLOAD_BYTES) throw new AssetError("Изображения: PNG, JPG, WEBP или GIF до 8 МБ");
    if (!extMatchesMime(file.name, file.type)) throw new AssetError("Расширение файла не соответствует его типу");
    const filename = `${target}-${Date.now()}-${safeName(file.name)}`;
    setAsset(target, `attachment://${filename}`);
    assets.push({ target, filename, file, bytes: Buffer.from(await file.arrayBuffer()) });
  }
  return assets;
}

export async function reattachStoredAssets<T extends string>(opts: {
  targets: readonly T[];
  urlOf: (target: T) => string | undefined;
  skipTargets: readonly T[];
  prefix: string;
  dir: string;
  setAsset: (target: T, url: string) => void;
  optional?: boolean;
}): Promise<{ assets: StoredAsset<T>[]; originals: OriginalAsset<T>[] }> {
  const assets: StoredAsset<T>[] = [];
  const originals: OriginalAsset<T>[] = [];
  for (const target of opts.targets) {
    if (opts.skipTargets.includes(target)) continue;
    const currentUrl = opts.urlOf(target);
    if (!currentUrl?.startsWith(opts.prefix)) continue;
    const filename = filenameFromUrl(opts.prefix, currentUrl);
    if (!filename) { if (opts.optional) continue; throw new AssetError("Не удалось найти сохранённое изображение."); }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(opts.dir, filename));
    } catch {
      if (opts.optional) continue;
      throw new AssetError("Не удалось прочитать сохранённое изображение.");
    }
    originals.push({ target, url: currentUrl });
    opts.setAsset(target, `attachment://${filename}`);
    assets.push({ target, filename, file: new File([new Uint8Array(bytes)], filename, { type: extMime(filename) }), bytes });
  }
  return { assets, originals };
}

export async function persistUploadedAssets<T extends string>(dir: string, prefix: string, assets: readonly StoredAsset<T>[], originals: readonly OriginalAsset<T>[], setAsset: (target: T, url: string) => void): Promise<void> {
  if (!assets.length) return;
  await mkdir(dir, { recursive: true });
  for (const asset of assets) {
    const saved = originals.find(entry => entry.target === asset.target);
    if (saved) { setAsset(asset.target, saved.url); continue; }
    await writeFile(join(dir, asset.filename), asset.bytes);
    setAsset(asset.target, prefix + asset.filename);
  }
}
