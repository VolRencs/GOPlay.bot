import test from "node:test";
import assert from "node:assert/strict";
import { embedCharacterCount, EMBED_LIMITS, normalizeEmbedContent, toDiscordEmbed } from "../src/contracts/embeds.ts";

test("normalizeEmbedContent accepts legacy string media and drops empty values", () => {
  const { content, halfFilled } = normalizeEmbedContent({
    title: "  Заголовок  ",
    description: "",
    footer: "  Футер  ",
    thumbnail: " https://example.com/t.png ",
    image: { url: " https://example.com/i.png " },
    author: { name: " Автор ", url: " https://example.com", iconUrl: " https://example.com/a.png " },
    color: 123,
  });
  assert.equal(halfFilled, false);
  assert.equal(content.title, "Заголовок");
  assert.equal(content.description, undefined);
  assert.deepEqual(content.footer, { text: "Футер" });
  assert.deepEqual(content.thumbnail, { url: "https://example.com/t.png" });
  assert.deepEqual(content.image, { url: "https://example.com/i.png" });
  assert.deepEqual(content.author, { name: "Автор", url: "https://example.com", iconUrl: "https://example.com/a.png" });
  assert.equal(content.color, 123);
});

test("normalizeEmbedContent limits fields and reports half-filled ones", () => {
  const fields = Array.from({ length: EMBED_LIMITS.fields - 1 }, (_, index) => ({
    name: `Поле ${index}`,
    value: "x".repeat(EMBED_LIMITS.fieldValue + 10),
    inline: true,
  }));
  const { content, halfFilled } = normalizeEmbedContent({
    fields: [...fields, { name: "Только имя", value: "" }],
  });
  assert.equal(halfFilled, true);
  assert.equal(content.fields?.length, EMBED_LIMITS.fields - 1);
  assert.equal(content.fields?.[0]?.value.length, EMBED_LIMITS.fieldValue);
});

test("embedCharacterCount includes title, description, fields, footer and author", () => {
  const count = embedCharacterCount({
    title: "123",
    description: "12345",
    footer: { text: "12" },
    author: { name: "1234" },
    fields: [{ name: "12", value: "123" }],
  });
  assert.equal(count, 3 + 5 + 2 + 4 + 5);
});

test("toDiscordEmbed maps author iconUrl to icon_url and normalizes fields", () => {
  const embed = toDiscordEmbed({
    title: "T",
    author: { name: "A", url: "https://example.com", iconUrl: "https://example.com/a.png" },
    image: { url: "https://example.com/i.png" },
    thumbnail: { url: "https://example.com/t.png" },
    fields: [{ name: "N", value: "V" }],
  });
  assert.deepEqual(embed.author, { name: "A", url: "https://example.com", icon_url: "https://example.com/a.png" });
  assert.deepEqual(embed.image, { url: "https://example.com/i.png" });
  assert.deepEqual(embed.thumbnail, { url: "https://example.com/t.png" });
  assert.deepEqual(embed.fields, [{ name: "N", value: "V", inline: false }]);
});
