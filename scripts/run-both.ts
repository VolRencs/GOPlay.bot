import { spawn, type ChildProcess } from "node:child_process";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("run-both: expected dev|start");

const nextArgs = mode === "start" ? [mode, "-H", "127.0.0.1"] : [mode];
const children: ChildProcess[] = [
  spawn("node_modules/.bin/next", nextArgs, { stdio: "inherit" }),
  spawn(process.execPath, ["--env-file=.env", "src/bot/index.ts"], { stdio: "inherit" }),
];

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
  child.on("error", error => { console.error("[run-both]", error); failPeer(child); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    failPeer(child);
    if (code || signal) process.exitCode = code ?? 1;
  });
}
