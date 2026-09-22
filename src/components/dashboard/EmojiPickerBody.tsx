"use client";

import { EmojiPicker as GoEmojiPicker, useEmojiData } from "goemoji";
import "goemoji/styles.css";
import type { ServerEmoji } from "./types.ts";

export default function EmojiPickerBody({ serverEmojis, onSelect, onEscape }: { serverEmojis: ServerEmoji[]; onSelect: (value: string) => void; onEscape: () => void }) {
  const { data, error } = useEmojiData(() => import("goemoji/data/ru.json"), []);
  if (error) return <p className="emoji-note">Не удалось загрузить эмодзи</p>;
  if (!data) return <p className="emoji-note">Загружаем эмодзи…</p>;
  return (
    <GoEmojiPicker
      data={data}
      serverEmojis={serverEmojis}
      columns={9}
      locale="ru"
      recentKey="goplay:emoji-recent"
      onEscape={onEscape}
      onSelect={emoji => onSelect(emoji.value)}
    />
  );
}
