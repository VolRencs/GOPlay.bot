// Общий пайплайн картинок для роутов, публикующих в Discord (embeds, events):
// свежие загрузки валидируются и становятся attachment://, сохранённые файлы
// переприкрепляются при правках; в БД после успешной отправки пишутся только
// локальные /uploads пути — attachment:// там не живёт.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const imageMimeTypes: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Расширение → MIME для переотправленных файлов: сравнивать "jpg" с MIME нельзя.
function extMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
}

// Несёт готовое сообщение пользователю; роуты мапят в 400.
export class AssetError extends Error {}

export type StoredAsset<T extends string> = { target: T; filename: string; file: File; bytes: Buffer };
type OriginalAsset<T extends string> = { target: T; url: string };

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

// Читает свежие файлы из формы, валидирует MIME/размер, регистрирует
// attachment:// через setAsset и буферизует байты.
export async function collectNewUploads<T extends string>(form: FormData | null, specs: readonly { formKey: string; target: T }[], setAsset: (target: T, url: string) => void): Promise<StoredAsset<T>[]> {
  const assets: StoredAsset<T>[] = [];
  for (const { formKey, target } of specs) {
    const file = form?.get(formKey);
    if (!(file instanceof File)) continue;
    if (!imageMimeTypes.includes(file.type) || file.size > MAX_UPLOAD_BYTES) throw new AssetError("Изображения: PNG, JPG, WEBP или GIF до 8 МБ");
    const filename = `${target}-${Date.now()}-${safeName(file.name)}`;
    setAsset(target, `attachment://${filename}`);
    assets.push({ target, filename, file, bytes: Buffer.from(await file.arrayBuffer()) });
  }
  return assets;
}

// Переотправка сохранённых локальных картинок для таргетов без новой загрузки.
// AssetError, если файл пропал или вылезает за пределы своего каталога.
export async function reattachStoredAssets<T extends string>(opts: {
  targets: readonly T[];
  urlOf: (target: T) => string | undefined;
  skipTargets: readonly T[];
  prefix: string;
  dir: string;
  setAsset: (target: T, url: string) => void;
}): Promise<{ assets: StoredAsset<T>[]; originals: OriginalAsset<T>[] }> {
  const assets: StoredAsset<T>[] = [];
  const originals: OriginalAsset<T>[] = [];
  for (const target of opts.targets) {
    if (opts.skipTargets.includes(target)) continue;
    const currentUrl = opts.urlOf(target);
    if (!currentUrl?.startsWith(opts.prefix)) continue;
    const filename = currentUrl.slice(opts.prefix.length);
    if (!filename || filename.includes("/") || filename.includes("\\")) throw new AssetError("Не удалось найти сохранённое изображение.");
    let bytes: Buffer;
    try {
      bytes = await readFile(join(opts.dir, filename));
    } catch {
      throw new AssetError("Не удалось прочитать сохранённое изображение.");
    }
    originals.push({ target, url: currentUrl });
    opts.setAsset(target, `attachment://${filename}`);
    assets.push({ target, filename, file: new File([new Uint8Array(bytes)], filename, { type: extMime(filename) }), bytes });
  }
  return { assets, originals };
}

// Пишет новые загрузки рядом с сохранёнными и восстанавливает локальные пути
// в payload. Таргеты с оригиналом сохраняют свой файл.
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
