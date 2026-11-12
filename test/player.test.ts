import test from "node:test"; import assert from "node:assert/strict";
import { useTempDb } from "./helpers.ts";

useTempDb("goplay-player-");
const {
  pickAudioFormat, formatHeaders, formatExpiresAt,
  mapBackendError, safeMediaTarget, normalizeTrackKey, isAllowedStreamUrl,
  isSingleYouTubeVideoUrl, pickFollowTarget,
  isNaturalEnd, isRetryableFailure, nextLoopMode, fmtTime,
  partitionByIndices, moveWithinList, shuffleWithin,
  ffmpegArgs, isRetryableResolveCode, shouldDropTrackOnHydration, redactMediaUrl,
} = await import("../src/lib/player/index.ts");

const fmt = (url: string, extra: Record<string, unknown>) => ({ url, protocol: "https", ...extra });

const pickUrl = (meta: Record<string, unknown>): string | null => {
  const url = pickAudioFormat(meta)?.url;
  return typeof url === "string" ? url : null;
};

test("pickAudioFormat: Opus → лучший audio-only по битрейту → best; манифесты отброшены", () => {
  assert.equal(pickUrl({ formats: [
    fmt("https://a.googlevideo.com/vorbis", { vcodec: "none", acodec: "vorbis", abr: 160 }),
    fmt("https://b.googlevideo.com/opus", { vcodec: "none", acodec: "opus", abr: 120 }),
  ] }), "https://b.googlevideo.com/opus");
  assert.equal(pickUrl({ formats: [
    fmt("https://x.googlevideo.com/m4a", { vcodec: "none", acodec: "mp4a.40.2", abr: 128 }),
    fmt("https://y.googlevideo.com/m4a2", { vcodec: "none", acodec: "mp4a.40.2", tbr: 256 }),
  ] }), "https://y.googlevideo.com/m4a2");
  assert.equal(pickUrl({ formats: [fmt("https://z.googlevideo.com/c", { vcodec: "avc1", acodec: "mp4a", tbr: 900 })] }), "https://z.googlevideo.com/c");
  assert.equal(pickUrl({ formats: [
    fmt("https://a.googlevideo.com/opus", { vcodec: "none", acodec: "opus", abr: 120 }),
    fmt("https://hls.example/x.m3u8", { protocol: "m3u8_native", vcodec: "none", acodec: "opus" }),
  ] }), "https://a.googlevideo.com/opus");
  assert.equal(pickUrl({ formats: [fmt("https://hls.example/x.m3u8", { protocol: "m3u8_native", vcodec: "none", acodec: "opus" })] }), "https://hls.example/x.m3u8");
  assert.equal(pickUrl({ formats: [fmt("not-a-url", { vcodec: "none" })] }), null);
  assert.equal(pickUrl({}), null);
});

test("pickAudioFormat: best_audio приоритетнее formats и отдаёт заголовки/срок", () => {
  const best = {
    url: "https://best.googlevideo.com/opus",
    protocol: "https",
    vcodec: "none",
    acodec: "opus",
    abr: 136,
    http_headers: { "User-Agent": "UA", Referer: "https://www.youtube.com/" },
    expires_at: 1_794_415_881,
  };
  const format = pickAudioFormat({
    best_audio: best,
    formats: [fmt("https://other.googlevideo.com/opus", { vcodec: "none", acodec: "opus", abr: 999 })],
  });
  assert.equal(format?.url, best.url);
  assert.deepEqual(formatHeaders(format!), { "User-Agent": "UA", Referer: "https://www.youtube.com/" });
  assert.equal(formatExpiresAt(format!), 1_794_415_881_000);
  assert.equal(formatExpiresAt({ url: "https://x.googlevideo.com/videoplayback?expire=123" }), 123_000);
});

test("pickAudioFormat: дорожка по умолчанию важнее громкой дублированной", () => {
  const defaultTrack = {
    id: "en", display_name: "English", audio_is_default: true,
  };
  const format = pickAudioFormat({ formats: [
    fmt("https://a.googlevideo.com/opus-dub", { vcodec: "none", acodec: "opus", abr: 192 }),
    fmt("https://b.googlevideo.com/opus-default", { vcodec: "none", acodec: "opus", abr: 96, audio_track: defaultTrack }),
  ] });
  assert.equal(format?.url, "https://b.googlevideo.com/opus-default");
});

test("SSRF-гейт и классификация ошибок бэкенда", () => {
  assert.equal(safeMediaTarget("https://www.youtube.com/watch?v=x"), "https://www.youtube.com/watch?v=x");
  assert.equal(safeMediaTarget("https://www.youtube-nocookie.com/embed/x"), "https://www.youtube-nocookie.com/embed/x");
  assert.equal(safeMediaTarget("http://m.youtube.com/shorts/x"), "http://m.youtube.com/shorts/x");
  assert.equal(safeMediaTarget("крутая песня"), null);
  assert.equal(safeMediaTarget("https://evil.example.com/video"), null);
  assert.equal(safeMediaTarget("http://localhost:8080/x"), null);
  assert.equal(safeMediaTarget("ftp://youtube.com/x"), null);

  assert.equal(isAllowedStreamUrl("https://rr2---sn-x.googlevideo.com/videoplayback"), true);
  assert.equal(isAllowedStreamUrl("https://www.youtube.com/api/manifest"), true);
  assert.equal(isAllowedStreamUrl("ftp://rr2---sn-x.googlevideo.com/videoplayback"), false);
  assert.equal(isAllowedStreamUrl("https://evil.example.com/x"), false);
  assert.equal(isAllowedStreamUrl("not-a-url"), false);

  assert.equal(mapBackendError("BOTCHECK"), "botcheck");
  assert.equal(mapBackendError("AGE_RESTRICTED"), "age-restricted");
  assert.equal(mapBackendError("PRIVATE"), "private");
  assert.equal(mapBackendError("UNAVAILABLE"), "unavailable");
  assert.equal(mapBackendError("COOKIES"), "cookies");
  assert.equal(mapBackendError("UNSUPPORTED_URL"), "unsupported-url");
  assert.equal(mapBackendError("INVALID_INPUT"), "invalid-query");
  assert.equal(mapBackendError("NO_AUDIO"), "no-audio");
  assert.equal(mapBackendError("NATIVE_LOAD"), "backend-unavailable");
  assert.equal(mapBackendError("TIMEOUT"), "network");
  assert.equal(mapBackendError("HTTP"), "network");
  assert.equal(mapBackendError("INVALID_RESPONSE"), "network");
  assert.equal(mapBackendError("CHALLENGE_FAILED"), "challenge-failed");
  assert.equal(mapBackendError("FORMAT_NOT_FOUND"), "no-audio");
});

test("fast-path: одиночное видео доверенного хоста, без list=, с id", () => {
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch?v=bWDu7-jNMbo"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://youtube.com/shorts/bWDu7-jNMbo"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://m.youtube.com/watch?t=30&v=x"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://youtu.be/bWDu7-jNMbo?t=1"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/v/bWDu7-jNMbo"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch?v=x&list=PL123"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch?v=nJqkWDFTK-Y&list=RDnJqkWDFTK-Y&start_radio=1"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/playlist?list=PL123"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://www.youtube.com/watch"), false);
  assert.equal(isSingleYouTubeVideoUrl("https://music.youtube.com/watch?v=x"), true);
  assert.equal(isSingleYouTubeVideoUrl("https://evil.example.com/watch?v=x"), false);
  assert.equal(isSingleYouTubeVideoUrl("крутая песня"), false);
});

test("ключ кэша сохраняет list и нормализует короткие ссылки", () => {
  assert.equal(normalizeTrackKey("https://www.youtube.com/watch?v=abc&list=PL1&t=30"), "https://youtube.com/watch?v=abc&list=PL1");
  assert.equal(normalizeTrackKey("https://youtu.be/abc?list=PL1&si=x"), "https://youtube.com/watch?v=abc&list=PL1");
  assert.equal(normalizeTrackKey("https://youtube.com/shorts/abcDEF12345?list=PL1"), "https://youtube.com/watch?v=abcDEF12345&list=PL1");
  assert.equal(normalizeTrackKey("https://youtube.com/watch?list=PL1&v=abc"), "https://youtube.com/watch?v=abc&list=PL1");
  assert.equal(normalizeTrackKey("https://youtube.com/playlist?list=PL1&si=x"), "https://youtube.com/playlist?list=PL1");
  assert.equal(normalizeTrackKey("https://www.youtube.com/watch?v=abc"), "https://youtube.com/watch?v=abc");
  assert.notEqual(normalizeTrackKey("https://www.youtube.com/watch?v=abc"), normalizeTrackKey("https://www.youtube.com/watch?v=abc&list=PL1"));
});

test("ретраи: временные ошибки повторяем, постоянные — сразу дальше", () => {
  assert.equal(isRetryableFailure({ kind: "stall", phase: "middle" }), true);
  assert.equal(isRetryableFailure({ kind: "eof" }), true);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "timeout", code: "TIMEOUT" }), true);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "spawn failed" }), true);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "botcheck", code: "BOTCHECK" }), false);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "challenge", code: "CHALLENGE_FAILED" }), false);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "too long", code: "TOO_LONG" }), false);
});

test("политика ретраев и hydration: временное повторяем, конфигурацию не трогаем", () => {
  assert.equal(isRetryableResolveCode("TIMEOUT"), true);
  assert.equal(isRetryableResolveCode("NETWORK"), true);
  assert.equal(isRetryableResolveCode("INVALID_RESPONSE"), true);
  assert.equal(isRetryableResolveCode("HTTP"), false);
  assert.equal(isRetryableResolveCode("BOTCHECK"), false);

  assert.equal(shouldDropTrackOnHydration("PRIVATE"), true);
  assert.equal(shouldDropTrackOnHydration("UNAVAILABLE"), true);
  assert.equal(shouldDropTrackOnHydration("TOO_LONG"), true);
  assert.equal(shouldDropTrackOnHydration("UNSAFE_URL"), true);
  assert.equal(shouldDropTrackOnHydration("BOTCHECK"), false);
  assert.equal(shouldDropTrackOnHydration("COOKIES"), false);
  assert.equal(shouldDropTrackOnHydration("NATIVE_LOAD"), false);
  assert.equal(shouldDropTrackOnHydration(undefined), false);

  assert.equal(isRetryableFailure({ kind: "source-error", detail: "ffmpeg", code: "FFMPEG" }), false);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "io", code: "IO" }), false);
  assert.equal(isRetryableFailure({ kind: "source-error", detail: "timeout", code: "TIMEOUT" }), true);
});

test("redactMediaUrl: подписанные googlevideo-ссылки не попадают в логи", () => {
  const signed = "https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&sig=secret";
  assert.equal(redactMediaUrl(`ffmpeg ${signed} failed`), "ffmpeg https://rr1---sn-x.googlevideo.com/[redacted] failed");
  assert.equal(redactMediaUrl("https://www.youtube.com/watch?v=abc"), "https://www.youtube.com/watch?v=abc");
  assert.equal(redactMediaUrl("no urls here"), "no urls here");
});

test("ytrust: native-аддон загружается", { skip: process.platform !== "linux" || process.arch !== "x64" }, async () => {
  const { version } = await import("ytrust");
  assert.match(version(), /^\d+\.\d+\.\d+/);
});

test("переход к автору трека: только другой канал из whitelist", () => {
  assert.equal(pickFollowTarget("vcA", "vcB", []), "vcB");
  assert.equal(pickFollowTarget(null, "vcB", []), "vcB");
  assert.equal(pickFollowTarget("vcA", "vcA", []), null);
  assert.equal(pickFollowTarget("vcA", null, []), null);
  assert.equal(pickFollowTarget("vcA", "vcC", ["vcB"]), null);
  assert.equal(pickFollowTarget("vcA", "vcB", ["vcB", "vcA"]), "vcB");
});

test("аргументы ffmpeg: -ss до -i, UA/Referer, без пайпа", () => {
  const headers = { "User-Agent": "VisionOS-UA", Referer: "https://www.youtube.com/" };
  const resumed = ffmpegArgs("https://rX---sn.googlevideo.com/videoplayback?id=x", 95, headers);
  const ss = resumed.indexOf("-ss");
  assert.ok(ss !== -1 && ss < resumed.indexOf("-i"));
  assert.equal(resumed[ss + 1], "95");
  const ua = resumed.indexOf("-user_agent");
  assert.equal(resumed[ua + 1], "VisionOS-UA");
  const extra = resumed.indexOf("-headers");
  assert.match(resumed[extra + 1] ?? "", /Referer: https:\/\/www\.youtube\.com\//);
  assert.deepEqual(resumed.slice(-18), ["-map", "0:a:0", "-vn", "-threads", "1", "-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-application", "audio", "-f", "ogg", "pipe:1"]);

  const plain = ffmpegArgs("https://rX---sn.googlevideo.com/videoplayback?id=x", 0);
  assert.equal(plain.includes("-ss"), false);
  assert.equal(plain.includes("-user_agent"), false);
  assert.equal(plain.includes("-headers"), false);
  assert.equal(plain[plain.indexOf("-i") + 1], "https://rX---sn.googlevideo.com/videoplayback?id=x");
  assert.equal(plain.includes("pipe:0"), false);
});

test("конец трека и цикл повтора off → track → queue → off", () => {
  assert.equal(isNaturalEnd(60, 240), false);
  assert.equal(isNaturalEnd(236, 240), true);
  assert.equal(isNaturalEnd(90, undefined), true);
  let mode: "off" | "track" | "queue" = "off";
  for (const expected of ["track", "queue", "off"] as const) { mode = nextLoopMode(mode); assert.equal(mode, expected); }
});

test("утилиты очереди: время, удаление по индексам, перемещение, шаффл", () => {
  assert.equal(fmtTime(60), "1:00");
  assert.equal(fmtTime(212.08), "3:32");
  assert.equal(fmtTime(7325), "2:02:05");
  assert.equal(fmtTime(-5), "0:00");

  const list = ["a", "b", "c", "d"];
  assert.deepEqual(partitionByIndices(list, [1, 3]), [["a", "c"], ["b", "d"]]);
  assert.deepEqual(partitionByIndices(list, [4, -1, 2.5, 2, 2]), [["a", "b", "d"], ["c"]]);
  assert.deepEqual(list, ["a", "b", "c", "d"]);

  const down = ["a", "b", "c", "d"];
  assert.equal(moveWithinList(down, 0, 2), 2);
  assert.deepEqual(down, ["b", "c", "a", "d"]);
  const toEnd = ["a", "b", "c", "d"];
  assert.equal(moveWithinList(toEnd, 1, 4), 3);
  assert.deepEqual(toEnd, ["a", "c", "d", "b"]);
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
