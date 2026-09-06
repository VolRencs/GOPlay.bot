import test from "node:test"; import assert from "node:assert/strict";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { mkdtempSync } from "node:fs";

// Ядро плеера тянет i18n → базу: изолируем во временную.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-player-")), "bot.sqlite");
const {
  parseYtDlpMeta, pickAudioUrl, safeYtDlpTarget,
  isBotcheckError, isSingleYouTubeVideoUrl, pickFollowTarget,
  isNaturalEnd, nextLoopMode, fmtTime,
  partitionByIndices, moveWithinList, shuffleWithin,
  ffmpegArgs, ytdlpArgsFor,
} = await import("../src/lib/player/index.ts");

// --- Резолвер yt-dlp -----------------------------------------------------------

const entry = (i: number) => `{"_type":"url","id":"v${i}","url":"https://www.youtube.com/watch?v=v${i}","title":"трек ${i} — портреты"}`;
const playlist = `{"_type":"playlist","title":"Mix - портреты","entries":[${Array.from({ length: 50 }, (_, i) => entry(i)).join(",")}]}`;
const single = `{"id":"bWDu7-jNMbo","title":"портреты (Acoustic)","duration":212.08,"webpage_url":"https://www.youtube.com/watch?v=bWDu7-jNMbo"}`;

test("parseYtDlpMeta: полный -J как есть, обрезанный капом восстанавливается, мусор — null", () => {
  assert.deepEqual(parseYtDlpMeta(single, false), JSON.parse(single));
  assert.deepEqual(parseYtDlpMeta(`${playlist}\n`, false), JSON.parse(playlist)); // хвостовой \n не мешает
  // срез внутри последней записи (кириллица рядом) и сразу после висячей запятой
  const midCut = parseYtDlpMeta(playlist.slice(0, playlist.indexOf(entry(49)) + 20), true);
  const entries = midCut?.entries as { url: string }[] | undefined;
  assert.ok(entries && entries.length >= 45 && entries.length < 50);
  assert.match(entries[0]!.url, /^https:\/\/www\.youtube\.com\/watch\?v=v\d+$/);
  const commaCut = parseYtDlpMeta(playlist.slice(0, playlist.indexOf(entry(49))), true);
  assert.equal((commaCut?.entries as unknown[]).length, 49);
  // обрыв без шансов на восстановление
  assert.equal(parseYtDlpMeta("not json at all", false), null);
  assert.equal(parseYtDlpMeta('{"_type":"playli', true), null);
});

test("pickAudioUrl: opus → лучший audio-only по битрейту → best; манифесты отброшены", () => {
  const fmt = (url: string, extra: Record<string, unknown>) => ({ url, protocol: "https", ...extra });
  assert.equal(pickAudioUrl({ formats: [
    fmt("https://a.googlevideo.com/vorbis", { vcodec: "none", acodec: "vorbis", abr: 160 }),
    fmt("https://b.googlevideo.com/opus", { vcodec: "none", acodec: "opus", abr: 120 }),
  ] }), "https://b.googlevideo.com/opus");
  assert.equal(pickAudioUrl({ formats: [
    fmt("https://x.googlevideo.com/m4a", { vcodec: "none", acodec: "mp4a.40.2", abr: 128 }),
    fmt("https://y.googlevideo.com/m4a", { vcodec: "none", acodec: "mp4a.40.2", tbr: 256 }),
  ] }), "https://y.googlevideo.com/m4a");
  assert.equal(pickAudioUrl({ formats: [fmt("https://z.googlevideo.com/c", { vcodec: "avc1", acodec: "mp4a", tbr: 900 })] }), "https://z.googlevideo.com/c");
  assert.equal(pickAudioUrl({ formats: [fmt("https://hls.example/x.m3u8", { protocol: "m3u8_native", vcodec: "none", acodec: "opus" })] }), null);
  assert.equal(pickAudioUrl({ formats: [fmt("not-a-url", { vcodec: "none" })] }), null);
  assert.equal(pickAudioUrl({}), null);
});

test("SSRF-гейт и классификация bot-проверки", () => {
  assert.equal(safeYtDlpTarget("https://www.youtube.com/watch?v=x"), "https://www.youtube.com/watch?v=x");
  assert.equal(safeYtDlpTarget("http://m.youtube.com/shorts/x"), "http://m.youtube.com/shorts/x");
  assert.equal(safeYtDlpTarget("крутая песня"), null); // без ytsearch
  assert.equal(safeYtDlpTarget("https://evil.example.com/video"), null); // чужой хост
  assert.equal(safeYtDlpTarget("http://localhost:8080/x"), null);
  assert.equal(safeYtDlpTarget("ftp://youtube.com/x"), null);
  assert.equal(isBotcheckError("Sign in to confirm you're not a bot"), true);
  assert.equal(isBotcheckError("HTTP Error 403: Forbidden"), false);
});

test("fast-path: одиночное видео доверенного хоста, без list=, с id", () => {
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch?v=bWDu7-jNMbo"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://youtube.com/shorts/bWDu7-jNMbo"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://m.youtube.com/watch?t=30&v=x"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://youtu.be/bWDu7-jNMbo?t=1"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch?v=x&list=PL123"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/playlist?list=PL123"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch"), false); // без id
  assert.equal(isSingleYouTubeVideoUrl("https://music.youtube.com/watch?v=x"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://evil.example.com/watch?v=x"), false);
  assert.equal(isSingleYouTubeVideoUrl("крутая песня"), false);
});

test("переход к автору трека: только другой канал из whitelist", () => {
  assert.equal(pickFollowTarget("vcA", "vcB", []), "vcB");
  assert.equal(pickFollowTarget(null, "vcB", []), "vcB"); // бот вне каналов
  assert.equal(pickFollowTarget("vcA", "vcA", []), null); // уже там
  assert.equal(pickFollowTarget("vcA", null, []), null); // автор не в войсе
  assert.equal(pickFollowTarget("vcA", "vcC", ["vcB"]), null); // whitelist запрещает
  assert.equal(pickFollowTarget("vcA", "vcB", ["vcB", "vcA"]), "vcB");
});

// --- Аргументы стрима ------------------------------------------------------------

test("аргументы стрима: -ss до -i у прямого URL, труба без -ss, seek через --download-sections", () => {
  const resumed = ffmpegArgs("https://rX---sn.googlevideo.com/videoplayback?id=x", 95);
  const ss = resumed.indexOf("-ss");
  assert.ok(ss !== -1 && ss < resumed.indexOf("-i")); // HTTP Range-seek до входа
  assert.equal(resumed[ss + 1], "95");
  assert.deepEqual(resumed.slice(-18), ["-map", "0:a:0", "-vn", "-threads", "1", "-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-application", "audio", "-f", "ogg", "pipe:1"]);
  const piped = ffmpegArgs(null, 0);
  assert.equal(piped.includes("-ss"), false);
  assert.equal(piped[piped.indexOf("-i") + 1], "pipe:0");
  const sections = ytdlpArgsFor(120, "https://youtube.com/watch?v=x");
  const at = sections.indexOf("--download-sections");
  assert.notEqual(at, -1);
  assert.equal(sections[at + 1], "*120-inf");
  assert.equal(sections.includes("--no-playlist"), true);
  assert.equal(ytdlpArgsFor(0, "q").includes("--download-sections"), false);
});

// --- Чистые операции очереди и утилиты --------------------------------------------

test("конец трека и цикл повтора off → track → queue → off", () => {
  // обрыв задолго до конца — не естественный; хвост с запасом 15 c и
  // неизвестная длительность (верим exit=0) — естественный.
  assert.equal(isNaturalEnd(60, 240), false);
  assert.equal(isNaturalEnd(236, 240), true);
  assert.equal(isNaturalEnd(90, undefined), true);
  let mode: "off" | "track" | "queue" = "off";
  for (const expected of ["track", "queue", "off"] as const) { mode = nextLoopMode(mode); assert.equal(mode, expected); }
});

test("утилиты очереди: время, удаление по индексам, перемещение, шаффл", () => {
  assert.equal(fmtTime(60), "1:00");
  assert.equal(fmtTime(212.08), "3:32"); // дробные секунды округляются
  assert.equal(fmtTime(7325), "2:02:05");
  assert.equal(fmtTime(-5), "0:00"); // мусор из сети не ломает рендер

  const list = ["a", "b", "c", "d"];
  assert.deepEqual(partitionByIndices(list, [1, 3]), [["a", "c"], ["b", "d"]]);
  // невалидные индексы и дубликаты молча игнорируются; список не мутируется
  assert.deepEqual(partitionByIndices(list, [4, -1, 2.5, 2, 2]), [["a", "b", "d"], ["c"]]);
  assert.deepEqual(list, ["a", "b", "c", "d"]);

  // слот вставки в исходной нумерации: в конец со сдвигом, в начало, невалидные
  assert.equal(moveWithinList(["a", "b", "c", "d"], 1, 4), 3);
  const moved = ["a", "b", "c", "d"];
  moveWithinList(moved, 3, 0);
  assert.deepEqual(moved, ["d", "a", "b", "c"]);
  const bad = ["a", "b"];
  assert.equal(moveWithinList(bad, 2, 0), -1);
  assert.equal(moveWithinList(bad, 0.5, 1), -1);
  assert.deepEqual(bad, ["a", "b"]);

  const shuffled = [1, 2, 3, 4, 5, 6, 7, 8];
  shuffleWithin(shuffled);
  assert.deepEqual([...shuffled].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});
