export function takeLogBatch<T extends { length: number }>(queue: T[], maxEmbeds: number, maxChars: number): T[] {
  const batch: T[] = [];
  let chars = 0;
  while (queue.length && batch.length < maxEmbeds) {
    const embed = queue[0]!;
    const length = embed.length;
    if (batch.length > 0 && chars + length > maxChars) break;
    batch.push(queue.shift()!);
    chars += length;
  }
  return batch;
}

export function isEmbedLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown };
  return value.status === 400 && Number(value.code) === 50035;
}
