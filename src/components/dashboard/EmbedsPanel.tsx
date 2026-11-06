"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { CardHeader, channelOptions, confirmAction, EmbedComposer, SaveButton, Select, TemplateLibrary, TemplateRow, formatTime, asFields, asString, useSessionDraft, useSessionDraftRestore } from "./ui.tsx";
import { apiGet, apiJsonMutate, apiMutate, apiSend } from "./api.ts";
import { useApiResource, useMediaField, usePanelAction } from "./hooks.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { colorNumberToHex, hexToColorNumber, DEFAULT_ACCENT, type EmbedField, type EmbedPayload } from "./types.ts";
import type { EmbedDto, EmbedSendingDto, EmbedsGetDto } from "#contracts/embeds.ts";

const INHERIT_CHANNEL = "Использовать исходный канал";

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

export function EmbedsPanel() {
  const { guildId, resources, notify: onDone, fail: onError } = useDashboard();
  const channels = resources?.channels ?? [];
  const { data, setData, reload } = useApiResource<EmbedsGetDto>(
    Boolean(guildId),
    signal => apiGet<EmbedsGetDto>(`/api/guilds/${guildId}/embeds`, { embeds: [], sendings: [] }, signal),
    [guildId],
    { embeds: [], sendings: [] },
  );
  const { embeds: items, sendings } = data;
  const [channel, setChannel] = useState("");
  const [form, setFormState] = useState<EmbedForm>(emptyEmbedForm);
  const setForm = (patch: Partial<EmbedForm>) => setFormState(current => ({ ...current, ...patch }));
  const { busy, run } = usePanelAction({ onDone, onError });
  const { busy: verifying, run: runVerify } = usePanelAction({ onDone, onError });
  const composerRef = useRef<HTMLDivElement>(null);
  const image = useMediaField(form.image);
  const thumbnail = useMediaField(form.thumbnail);
  const authorIcon = useMediaField(form.authorIcon);

  const draftKey = `goplay-draft-embeds-${guildId}`;
  useSessionDraft(draftKey, Boolean(guildId), [form], () => form);
  useSessionDraftRestore(draftKey, Boolean(guildId), d => {
    const hasContent = asString(d.title) || asString(d.description) || asString(d.name);
    if (d.id || !hasContent) return;
    setForm({
      name: asString(d.name), mode: d.mode === "text" ? "text" : "embed", title: asString(d.title), description: asString(d.description),
      footer: asString(d.footer), author: asString(d.author), authorUrl: asString(d.authorUrl), authorIcon: asString(d.authorIcon),
      color: asString(d.color, DEFAULT_ACCENT), fields: asFields(d.fields), image: asString(d.image), thumbnail: asString(d.thumbnail),
    });
  });

  const payload: EmbedPayload = {
    title: form.title,
    description: form.description,
    color: hexToColorNumber(form.color),
    footer: { text: form.footer },
    ...(form.author.trim() ? { author: { name: form.author, ...(form.authorUrl.trim() ? { url: form.authorUrl.trim() } : {}), ...(form.authorIcon ? { iconUrl: form.authorIcon } : {}) } } : {}),
    fields: form.fields,
    image: { url: form.image },
    thumbnail: { url: form.thumbnail },
  };

  function verifySendings() {
    void runVerify(
      () => apiSend<EmbedsGetDto>(`/api/guilds/${guildId}/embeds?verify=1`, {}, "Не удалось проверить отправления."),
      next => { setData(next); return { message: "Список отправлений проверен." }; },
    );
  }

  function editTemplate(item: EmbedDto) {
      const parsed = item.payload;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return onError("Шаблон повреждён и не может быть загружен в редактор.");
    const p = parsed;
    setForm({
      id: item.id,
      published: Boolean(item.messageId),
      name: item.name,
      mode: item.mode,
      title: p.title ?? "",
      description: p.description ?? "",
      footer: p.footer?.text ?? "",
      author: p.author?.name ?? "",
      authorUrl: p.author?.url ?? "",
      authorIcon: p.author?.iconUrl ?? "",
      color: colorNumberToHex(p.color),
      fields: (p.fields ?? []).map(field => ({ ...field, inline: Boolean(field.inline) })),
      image: p.image?.url ?? "",
      thumbnail: p.thumbnail?.url ?? "",
    });
    image.clear(); thumbnail.clear(); authorIcon.clear();
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset() {
    setFormState(emptyEmbedForm());
    image.clear(); thumbnail.clear(); authorIcon.clear();
    try { sessionStorage.removeItem(draftKey); } catch {}
  }

  const clearImage = () => { setForm({ image: "" }); image.clear(); };
  const clearThumbnail = () => { setForm({ thumbnail: "" }); thumbnail.clear(); };
  const clearAuthor = () => { setForm({ authorIcon: "" }); authorIcon.clear(); };

  async function submit(action: "save" | "update") {
    if (!form.name.trim()) return onError("Укажите название шаблона.");
    const upload = new FormData();
    upload.set("data", JSON.stringify({ id: form.id, name: form.name, mode: form.mode, saveOnly: action === "save", updateMessage: action === "update", payload }));
    if (image.file) upload.set("imageFile", image.file);
    if (thumbnail.file) upload.set("thumbnailFile", thumbnail.file);
    if (authorIcon.file) upload.set("authorFile", authorIcon.file);
    await run(
      () => apiSend<{ id?: number }>(`/api/guilds/${guildId}/embeds`, { method: "POST", body: upload }, "Не удалось сохранить сообщение."),
      data => {
        if (action === "save" && data.id) setForm({ id: data.id });
        sessionStorage.removeItem(draftKey);
        return { message: action === "save" ? "Шаблон сохранён. Его можно отправить из списка выше." : "Опубликованное сообщение обновлено." };
      },
      reload,
    );
  }

  async function resend(item: EmbedDto) {
    const targetChannel = channel || item.channelId;
    if (!targetChannel) return onError("Выберите канал для первого отправления шаблона.");
    await run(
      () => apiJsonMutate(`/api/guilds/${guildId}/embeds`, "POST", { id: item.id, name: item.name, channelId: targetChannel, mode: item.mode, payload: item.payload }, "Не удалось отправить шаблон."),
      () => ({ message: "Шаблон отправлен." }),
      reload,
    );
  }

  async function remove(item: EmbedDto) {
    if (!(await confirmAction(`Удалить «${item.name}» из Discord и списка шаблонов?`, "Удалить"))) return;
    await run(
      () => apiMutate(`/api/guilds/${guildId}/embeds?id=${item.id}`, { method: "DELETE" }, "Не удалось удалить сообщение."),
      () => {
        if (form.id === item.id) reset();
        return { message: "Embed-сообщение удалено." };
      },
      reload,
    );
  }

  async function removeSending(s: EmbedSendingDto) {
    if (!(await confirmAction("Удалить это отправленное сообщение из Discord?", "Удалить"))) return;
    await run(
      () => apiMutate(`/api/guilds/${guildId}/embeds?sendingId=${s.id}`, { method: "DELETE" }, "Не удалось удалить сообщение."),
      () => ({ message: "Отправленное сообщение удалено." }),
      reload,
    );
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
              placeholder={INHERIT_CHANNEL} options={channelOptions(channels, INHERIT_CHANNEL)}/>
          </label>
        )}
        empty="Сохранённых сообщений пока нет."
      >
        {items.length > 0 ? (
          <div className="template-list">
            {items.map(item => {
              const itemSendings = sendings.filter(s => s.embedId === item.id);
              return (
                <TemplateRow key={item.id} actions={<>
                  <button className="btn secondary" type="button" onClick={() => editTemplate(item)}>Изменить</button>
                  <button className="btn success" type="button" disabled={busy} onClick={() => void resend(item)}>{item.messageId ? "Отправить ещё раз" : "Отправить"}</button>
                  <button className="btn danger" type="button" disabled={busy} onClick={() => void remove(item)} aria-label={`Удалить ${item.name}`}><Trash2 size={16}/>Удалить</button>
                </>}>
                  <strong>{item.name}</strong>
                  <p className="muted">{item.messageId ? "Опубликовано — можно обновить" : "Черновик"}{itemSendings.length > 0 ? ` · Отправлено раз: ${itemSendings.length}` : ""}</p>
                  {itemSendings.length > 0 && (
                    <div className="sending-list">
                      {itemSendings.map(s => {
                        const ch = channels.find(c => c.id === s.channelId);
                        return (
                          <span key={s.id} className="sending-item">#{ch?.name ?? s.channelId} — {formatTime(s.sentAt)}
                            {" "}
                            <button type="button" className="btn danger small icon-only" aria-label={`Удалить отправленную копию от ${formatTime(s.sentAt)}`} disabled={busy} onClick={() => void removeSending(s)}><Trash2 size={12}/></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </TemplateRow>
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
            <EmbedComposer
              color={form.color}
              onColorChange={color => setForm({ color })}
              value={form}
              onChange={patch => setForm(patch)}
              image={{ file: image.file, preview: image.preview, saved: Boolean(form.image), inputRef: image.inputRef, onPick: image.setFile, onClear: clearImage }}
              thumbnail={{ file: thumbnail.file, preview: thumbnail.preview, saved: Boolean(form.thumbnail), inputRef: thumbnail.inputRef, onPick: thumbnail.setFile, onClear: clearThumbnail }}
              author={{
                name: form.author,
                url: form.authorUrl,
                icon: { file: authorIcon.file, preview: authorIcon.preview, saved: Boolean(form.authorIcon), inputRef: authorIcon.inputRef, onPick: authorIcon.setFile, onClear: clearAuthor },
                onChange: patch => setForm({
                  ...(patch.name !== undefined ? { author: patch.name } : {}),
                  ...(patch.url !== undefined ? { authorUrl: patch.url } : {}),
                }),
              }}
            />
          ) : (
            <label>Текст<textarea rows={7} value={form.description} maxLength={2000} onChange={e => setForm({ description: e.target.value })}/></label>
          )}
          <div className="template-actions">
            <SaveButton saving={busy} onClick={() => void submit("save")} label="Сохранить шаблон"/>
            {form.published && <SaveButton saving={busy} onClick={() => void submit("update")} label="Обновить опубликованное" savingLabel="Обновляем…"/>}
          </div>
          {form.id && !form.published && <p className="hint">Шаблон сохранён. Отправьте его из блока «Сохранённые сообщения».</p>}
        </section>
      </div>
    </section>
  );
}
