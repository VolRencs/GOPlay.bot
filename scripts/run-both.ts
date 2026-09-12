import { spawn, type ChildProcess } from "node:child_process";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("run-both: expected dev|start");

const children: ChildProcess[] = [
  spawn("node_modules/.bin/next", [mode], { stdio: "inherit" }),
  spawn(process.execPath, ["--env-file=.env", "src/bot/index.ts"], { stdio: "inherit" }),
];

// Весь сигнал получает группа процессов; дублирование безвредно — бот
// завершается синхронно с process.exit, Next гаснет сам.
let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const failPeer = (child: ChildProcess) => {
  if (stopping) return;
  stopping = true;
  for (const peer of children) if (peer !== child) peer.kill("SIGTERM");
};

for (const child of children) {
  // spawn ENOENT: 'error' без 'exit' — иначе uncaught-исключение и бот-сирота.
  child.on("error", error => { console.error("[run-both]", error); failPeer(child); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    // Один процесс упал — гасим второй и завершаемся с его кодом/сигналом.
    failPeer(child);
    if (code || signal) process.exitCode = code ?? 1;
  });
}
