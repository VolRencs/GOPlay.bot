/** Интервалы бота — unref: не держат процесс живым после shutdown. */
export function unrefInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const timer = setInterval(fn, ms);
  timer.unref?.();
  return timer;
}
