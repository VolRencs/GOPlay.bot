import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("run-both: expected dev|start");

const root = join(import.meta.dirname, "..");
const nextArgs = [mode, "-H", "127.0.0.1"];
const children: ChildProcess[] = [
  spawn(join(root, "node_modules", ".bin", "next"), nextArgs, { stdio: "inherit", cwd: root }),
  spawn(process.execPath, ["--env-file=.env", join(root, "src", "bot", "index.ts")], { stdio: "inherit", cwd: root }),
];

let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 5_000).unref();
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const failPeer = (child: ChildProcess) => {
  if (stopping) return;
  stopping = true;
  for (const peer of children) if (peer !== child) peer.kill("SIGTERM");
  setTimeout(() => {
    for (const peer of children) if (peer !== child && peer.exitCode === null && peer.signalCode === null) peer.kill("SIGKILL");
  }, 5_000).unref();
};

for (const child of children) {
  child.on("error", error => { console.error("[run-both]", error); failPeer(child); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    failPeer(child);
    if (code || signal) process.exitCode = code ?? 1;
  });
}
