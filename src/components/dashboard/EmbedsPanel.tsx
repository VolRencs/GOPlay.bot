"use client";

import { useEffect, useRef, useState } from "react";
import { Image, Trash2, User } from "lucide-react";
import { safeJson } from "../../../src/lib/json.ts";
import { CardHeader, channelOptions, ColorRow, confirmAction, FieldsEditor, MediaField, Select, TemplateLibrary, useAsyncAction, useObjectUrl } from "./ui.tsx";
import { apiGet, apiMutate, apiSend } from "./api.ts";
import { DEFAULT_ACCENT, type Channel, type EmbedPayload, type EmbedSending, type SavedEmbed } from "./types.ts";

type EmbedField = { name: string; value: string; inline: boolean };

type EmbedForm = {
  id?: number;
  published: boolean;
  name: string;
  mode: "embed" | "text";
  title: string;
  description: string;
  footer: string;
  author: string;
  authorUrl: string;
  authorIcon: string;
  color: string;
  fields: EmbedField[];
  image: string;
  thumbnail: string;
};
const emptyEmbedForm = (): EmbedForm => ({ published: false, name: "", mode: "embed", title: "", description: "", footer: "", author: "", authorUrl: "", authorIcon: "", color: DEFAULT_ACCENT, fields: [], image: "", thumbnail: "" });

export function EmbedsPanel({ guildId, channels, onDone, onError }: { guildId: string; channels: Channel[]; onDone: (message: string, tone?: "ok" | "warn") => void; onError: (message: string) => void }) {
  const [items, setItems] = useState<SavedEmbed[]>([]);
  const [sendings, setSendings] = useState<EmbedSending[]>([]);
  const [channel, setChannel] = useState("");
  const [form, setFormState] = useState<EmbedForm>(emptyEmbedForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [authorFile, setAuthorFile] = useState<File | null>(null);
  const setForm = (patch: Partial<EmbedForm>) => setFormState(current => ({ ...current, ...patch }));
  const { busy, run } = useAsyncAction();
  const { busy: verifying, run: runVerify } = useAsyncAction();
  const composerRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const thumbnailInput = useRef<HTMLInputElement>(null);
  const authorInput = useRef<HTMLInputElement>(null);
  const imagePreview = useObjectUrl(imageFile) || form.image;
  const thumbnailPreview = useObjectUrl(thumbnailFile) || form.thumbnail;
  const authorIconPreview = useObjectUrl(authorFile) || form.authorIcon;

  const draftKey = `goplay-draft-embeds-${guildId}`;
  useEffect(() => {
    if (!guildId) return;
    const timer = setTimeout(() => {
      try { sessionStorage.setItem(draftKey, JSON.stringify({ ...form, id: form.id ?? null })); } catch { /* storage full or unavailable */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [draftKey, guildId, form]);
  useEffect(() => {
    if (!guildId) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const d = safeJson<Record<string, unknown>>(raw, {});
      if (!d || typeof d !== "object" || Array.isArray(d) || d.id) return;
      if (!(typeof d.title === "string" && d.title) && !(typeof d.description === "string" && d.description) && !(typeof d.name === "string" && d.name)) return;
      setForm({
        name: String(d.name ?? ""),
        mode: d.mode === "text" ? "text" : "embed",
        title: String(d.title ?? ""),
        description: String(d.description ?? ""),
        footer: String(d.footer ?? ""),
        author: String(d.author ?? ""),
        authorUrl: String(d.authorUrl ?? ""),
        authorIcon: String(d.authorIcon ?? ""),
        color: typeof d.color === "string" ? d.color : DEFAULT_ACCENT,
        fields: Array.isArray(d.fields) ? d.fields.map(field => ({ name: String((field as { name?: unknown })?.name ?? ""), value: String((field as { value?: unknown })?.value ?? ""), inline: Boolean((field as { inline?: unknown })?.inline) })) : [],
        image: String(d.image ?? ""),
        thumbnail: String(d.thumbnail ?? ""),
      });
    } catch { /* malformed draft */ }
  }, [guildId, draftKey]);

  const payload: EmbedPayload = {
    title: form.title,
    description: form.description,
    color: parseInt(form.color.slice(1), 16),
    footer: { text: form.footer },
    ...(form.author.trim() ? { author: { name: form.author, ...(form.authorUrl.trim() ? { url: form.authorUrl.trim() } : {}), ...(form.authorIcon ? { icon_url: form.authorIcon } : {}) } } : {}),
    fields: form.fields,
    image: { url: form.image },
    thumbnail: { url: form.thumbnail },
  };

  const load = async (verify = false) => {
    const data = await apiGet(`/api/guilds/${guildId}/embeds${verify ? "?verify=1" : ""}`, { embeds: [], sendings: [] });
    setItems(data.embeds ?? []);
    setSendings(data.sendings ?? []);
  };
  useEffect(() => { load(); }, [guildId]);

  function verifySendings() {
    if (verifying) return;
    runVerify(async () => {
      try {
        await load(true);
        onDone("Список отправлений проверен.");
      } catch {
        onError("Не удалось проверить список отправлений.");
      }
    });
  }

  function editTemplate(item: SavedEmbed) {
      const parsed = safeJson<Partial<EmbedPayload>>(item.payload_json, {});
      // safeJson пропускает JSON-null: строка 'null' в БД не должна дойти до чтения полей.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return onError("Шаблон повреждён и не может быть загружен в редактор.");
    const p = parsed as EmbedPayload;
    setForm({
      id: item.id,
      published: Boolean(item.message_id),
      name: item.name,
      mode: item.mode,
      title: p.title ?? "",
      description: p.description ?? "",
      footer: p.footer?.text ?? "",
      author: p.author?.name ?? "",
      authorUrl: p.author?.url ?? "",
      authorIcon: p.author?.icon_url ?? "",
      color: `#${(p.color ?? 5793266).toString(16).padStart(6, "0")}`,
      fields: (p.fields ?? []).map(field => ({ ...field, inline: Boolean(field.inline) })),
      image: p.image?.url ?? "",
      thumbnail: p.thumbnail?.url ?? "",
    });
    setImageFile(null); setThumbnailFile(null); setAuthorFile(null);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset() {
    setForm(emptyEmbedForm());
    setImageFile(null); setThumbnailFile(null); setAuthorFile(null);
    try { sessionStorage.removeItem(draftKey); } catch {}
    if (imageInput.current) imageInput.current.value = "";
    if (thumbnailInput.current) thumbnailInput.current.value = "";
    if (authorInput.current) authorInput.current.value = "";
  }

  const clearImage = () => { setForm({ image: "" }); setImageFile(null); if (imageInput.current) imageInput.current.value = ""; };
  const clearThumbnail = () => { setForm({ thumbnail: "" }); setThumbnailFile(null); if (thumbnailInput.current) thumbnailInput.current.value = ""; };
  const clearAuthor = () => { setForm({ authorIcon: "" }); setAuthorFile(null); if (authorInput.current) authorInput.current.value = ""; };

  async function submit(action: "save" | "update") {
    if (busy) return;
    if (!form.name.trim()) return onError("Укажите название шаблона.");
    await run(async () => {
      const upload = new FormData();
      upload.set("data", JSON.stringify({ id: form.id, name: form.name, mode: form.mode, saveOnly: action === "save", updateMessage: action === "update", payload }));
      upload.set("name", form.name);
      if (imageFile) upload.set("imageFile", imageFile);
      if (thumbnailFile) upload.set("thumbnailFile", thumbnailFile);
      if (authorFile) upload.set("authorFile", authorFile);
      const sent = await apiSend<{ id?: number }>(`/api/guilds/${guildId}/embeds`, { method: "POST", body: upload }, "Не удалось сохранить сообщение.");
      if (!sent.ok) return onError(sent.error);
      if (action === "save" && sent.data.id) setForm({ id: sent.data.id });
      onDone(action === "save" ? "Шаблон сохранён. Его можно отправить из списка выше." : "Опубликованное сообщение обновлено.");
      sessionStorage.removeItem(draftKey);
      load();
    });
  }

  async function resend(item: SavedEmbed) {
    if (busy) return;
    const targetChannel = channel || item.channel_id;
    if (!targetChannel) return onError("Выберите канал для первого отправления шаблона.");
    await run(async () => {
      const result = await apiMutate(`/api/guilds/${guildId}/embeds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, name: item.name, channelId: targetChannel, mode: item.mode, payload: safeJson<Partial<EmbedPayload>>(item.payload_json, {}) as EmbedPayload }),
      }, "Не удалось отправить шаблон.");
      if (!result.ok) return onError(result.error);
      onDone("Шаблон отправлен."); load();
    });
  }

  async function remove(item: SavedEmbed) {
    if (!(await confirmAction(`Удалить «${item.name}» из Discord и списка шаблонов?`, "Удалить"))) return;
    await run(async () => {
      const result = await apiMutate(`/api/guilds/${guildId}/embeds?id=${item.id}`, { method: "DELETE" }, "Не удалось удалить сообщение.");
      if (!result.ok) return onError(result.error);
      onDone("Embed-сообщение удалено."); load();
    });
  }

  async function removeSending(s: EmbedSending) {
    if (!(await confirmAction("Удалить это отправленное сообщение из Discord?", "Удалить"))) return;
    await run(async () => {
      const result = await apiMutate(`/api/guilds/${guildId}/embeds?sendingId=${s.id}`, { method: "DELETE" }, "Не удалось удалить сообщение.");
      if (!result.ok) return onError(result.error);
      onDone("Отправленное сообщение удалено."); load();
    });
  }

  return (
    <section className="panel-stack">
      <TemplateLibrary
        title="Сохранённые сообщения"
        note={items.length ? String(items.length) : undefined}
        description="Сохраните шаблон, затем отправьте его в исходный канал или выберите другой. Последняя отправленная копия доступна для обновления."
        action={(
          <div className="template-actions">
            <button type="button" className="btn secondary" disabled={verifying} onClick={() => void verifySendings()}>{verifying ? "Проверяем…" : "Проверить актуальность"}</button>
          </div>
        )}
        extra={(
          <label>
            Канал для отправки
            <Select value={channel} onChange={setChannel} ariaLabel="Канал для отправки"
              placeholder="Использовать исходный канал" options={channelOptions(channels, "Использовать исходный канал")}/>
          </label>
        )}
        empty="Сохранённых сообщений пока нет."
      >
        {items.length > 0 ? (
          <div className="template-list">
            {items.map(item => {
              const itemSendings = sendings.filter(s => s.embed_id === item.id);
              return (
                <article className="template-item" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p className="muted">{item.message_id ? "Опубликовано — можно обновить" : "Черновик"}{itemSendings.length > 0 ? ` · Отправлено раз: ${itemSendings.length}` : ""}</p>
                    {itemSendings.length > 0 && (
                      <div className="sending-list">
                        {itemSendings.map(s => {
                          const ch = channels.find(c => c.id === s.channel_id);
                          return (
                            <span key={s.id} className="sending-item">#{ch?.name ?? s.channel_id} — {new Date(s.sent_at).toLocaleString("ru-RU")}
                              {" "}
                              <button type="button" className="sending-remove" aria-label={`Удалить отправленную копию от ${new Date(s.sent_at).toLocaleString("ru-RU")}`} disabled={busy} onClick={() => void removeSending(s)}><Trash2 size={12}/></button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="template-actions">
                    <button className="btn secondary" type="button" onClick={() => editTemplate(item)}>Изменить</button>
                    <button className="btn" type="button" disabled={busy} onClick={() => void resend(item)}>{item.message_id ? "Отправить ещё раз" : "Отправить"}</button>
                    <button className="btn danger" type="button" disabled={busy} onClick={() => void remove(item)} aria-label={`Удалить ${item.name}`}><Trash2 size={16}/>Удалить</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </TemplateLibrary>
      <div ref={composerRef} className="embed-composer-layout">
        <section className="card settings-card">
          <CardHeader title={form.id ? "Редактирование сообщения" : "Новое сообщение"}
            muted="Сохранение не публикует сообщение. Канал выбирается в списке сохранённых шаблонов."
            action={form.id && <button type="button" className="btn secondary" onClick={reset}>Новый</button>}/>
          <div className="compact-form-grid">
            <label>Название<input value={form.name} maxLength={100} onChange={e => setForm({ name: e.target.value })}/></label>
            <label>Тип
              <Select value={form.mode} onChange={mode => setForm({ mode: mode as "embed" | "text" })} ariaLabel="Тип сообщения"
                options={[{ value: "embed", label: "Embed" }, { value: "text", label: "Текст" }]}/>
            </label>
          </div>
          {form.mode === "embed" ? (
            <div className="embed-form" style={{ borderLeftColor: form.color }}>
              <ColorRow color={form.color} onChange={color => setForm({ color })}/>
              <div className="embed-author-row">
                <input value={form.author} maxLength={256} placeholder="Имя автора" onChange={e => setForm({ author: e.target.value })}/>
                {form.author && (
                  <>
                    <input value={form.authorUrl} maxLength={256} placeholder="Ссылка автора https://…" onChange={e => setForm({ authorUrl: e.target.value })}/>
                    <MediaField icon={<User size={18}/>} label="Иконка автора" file={authorFile} previewUrl={authorIconPreview} saved={Boolean(form.authorIcon)} onPick={setAuthorFile} onClear={clearAuthor} inputRef={authorInput}/>
                  </>
                )}
              </div>
              <input className="embed-title-input" value={form.title} maxLength={256} placeholder="Заголовок" onChange={e => setForm({ title: e.target.value })}/>
              <textarea className="embed-description-input" rows={6} value={form.description} maxLength={4096} placeholder="Описание" onChange={e => setForm({ description: e.target.value })}/>
              <FieldsEditor fields={form.fields} onChange={fields => setForm({ fields })}/>
              <input className="embed-footer-input" value={form.footer} maxLength={2048} placeholder="Футер" onChange={e => setForm({ footer: e.target.value })}/>
              <div className="embed-bottom">
                <MediaField icon={<Image size={18}/>} label="Основное изображение" file={imageFile} previewUrl={imagePreview} saved={Boolean(form.image)} onPick={setImageFile} onClear={clearImage} inputRef={imageInput} clearLabel="Удалить изображение"/>
                <MediaField icon={<Image size={18}/>} label="Миниатюра" file={thumbnailFile} previewUrl={thumbnailPreview} saved={Boolean(form.thumbnail)} onPick={setThumbnailFile} onClear={clearThumbnail} inputRef={thumbnailInput} clearLabel="Удалить миниатюру"/>
              </div>
            </div>
          ) : (
            <label>Текст<textarea rows={7} value={form.description} maxLength={2000} onChange={e => setForm({ description: e.target.value })}/></label>
          )}
          <div className="template-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void submit("save")}>{busy ? "Сохраняем…" : "Сохранить шаблон"}</button>
            {form.published && <button type="button" className="btn secondary" disabled={busy} onClick={() => void submit("update")}>{busy ? "Обновляем…" : "Обновить опубликованное"}</button>}
          </div>
          {form.id && !form.published && <p className="hint">Шаблон сохранён. Отправьте его из блока «Сохранённые сообщения».</p>}
        </section>
      </div>
    </section>
  );
}
