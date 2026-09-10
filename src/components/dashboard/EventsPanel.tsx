"use client";

import { useEffect, useState } from "react";
import { Image, Trash2 } from "lucide-react";
import { eventStatusMeta } from "../../../src/lib/labels.ts";
import { safeJson } from "../../../src/lib/json.ts";
import type { EventListGet, EventListItem } from "../../../src/lib/events.ts";
import { buttonColorOptions, DEFAULT_ACCENT, type Channel, type EmbedField, type PanelFail, type PanelNotify, type Role, type ServerEmoji } from "./types.ts";
import { CardHeader, channelOptions, ColorRow, confirmAction, EmojiPicker, FieldsEditor, formatTime, MediaField, NumberField, SaveButton, Select, TemplateLibrary, useAsyncAction, useObjectUrl } from "./ui.tsx";
import { apiGet, apiMutate, apiSend } from "./api.ts";

const EVENT_TONE: Record<string, string> = { scheduled: "pill-info", live: "pill-ok", completed: "pill-accent", cancelled: "pill-err" };
type EventDraft = { channelId: string; scheduledAt: string; maxParticipants: number; registrationEnabled: boolean; waitlistEnabled: boolean; status: string; eventRoleId: string; reminders: string; recurrenceFreq: string; recurrenceInterval: number; title: string; description: string; color: string; footer: string; timestamp: boolean; thumbnail: string; image: string; thumbnailFile: File | null; imageFile: File | null; fields: EmbedField[]; joinLabel: string; joinEmoji: string; joinStyle: string; joinEnabled: boolean; leaveLabel: string; leaveEmoji: string; leaveStyle: string; leaveEnabled: boolean };
const toLocalInput = (ts: number) => new Date(ts - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const defaultEventDraft = (): EventDraft => ({ channelId: "", scheduledAt: toLocalInput(Date.now() + 3_600_000), maxParticipants: 0, registrationEnabled: true, waitlistEnabled: true, status: "scheduled", eventRoleId: "", reminders: "", recurrenceFreq: "none", recurrenceInterval: 7, title: "", description: "", color: DEFAULT_ACCENT, footer: "", timestamp: true, thumbnail: "", image: "", thumbnailFile: null, imageFile: null, fields: [], joinLabel: "Участвовать", joinEmoji: "✅", joinStyle: "primary", joinEnabled: true, leaveLabel: "Отказаться", leaveEmoji: "❌", leaveStyle: "danger", leaveEnabled: true });

function ButtonEditor({ title, label, emoji, style, enabled, emojis, onChange }: { title: string; label: string; emoji: string; style: string; enabled: boolean; emojis: ServerEmoji[]; onChange: (change: { label?: string; emoji?: string; style?: string; enabled?: boolean }) => void }) {
  return (
    <div className="event-button-editor">
      <strong>{title}</strong>
      <label>
        Подпись
        <input value={label} maxLength={80} onChange={e => onChange({ label: e.target.value })}/>
      </label>
      <div className="role-emoji-field">
        <span className="field-label">Эмодзи</span>
        <EmojiPicker value={emoji} onChange={emoji => onChange({ emoji })} serverEmojis={emojis}/>
      </div>
      <label>
        Цвет
        <Select value={style} onChange={style => onChange({ style })} ariaLabel="Цвет кнопки"
          options={Object.entries(buttonColorOptions).map(([value, colorLabel]) => ({ value, label: colorLabel }))}/>
      </label>
      <label className="check-row"><input type="checkbox" checked={enabled} onChange={e => onChange({ enabled: e.target.checked })}/> Кнопка видна</label>
    </div>
  );
}

export function EventsPanel({ guildId, channels, roles, emojis, onDone, onError }: { guildId: string; channels: Channel[]; roles: Role[]; emojis: ServerEmoji[]; onDone: PanelNotify; onError: PanelFail }) {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft>(defaultEventDraft);
  const { busy, run } = useAsyncAction();
  const thumbnailPreview = useObjectUrl(draft.thumbnailFile) || draft.thumbnail;
  const imagePreview = useObjectUrl(draft.imageFile) || draft.image;

  const draftKey = `goplay-draft-event-${guildId}`;
  useEffect(() => {
    if (!guildId) return;
    const timer = setTimeout(() => {
      try {
        // Файлы не сериализуемы — replacer выкидывает их без промежуточных копий.
        sessionStorage.setItem(draftKey, JSON.stringify({ editingId, ...draft }, (_key, value) => value instanceof File ? undefined : value));
      } catch { /* storage full or unavailable */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [draftKey, guildId, editingId, draft]);
  useEffect(() => {
    if (!guildId) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const saved = safeJson<Record<string, unknown>>(raw, {});
      if (!saved || typeof saved !== "object") return;
      if (!(typeof saved.title === "string" && saved.title) && !(typeof saved.description === "string" && saved.description)) return;
      setEditingId(typeof saved.editingId === "string" && saved.editingId ? saved.editingId : null);
      setDraft(d => ({
        ...d,
        channelId: typeof saved.channelId === "string" ? saved.channelId : d.channelId,
        scheduledAt: typeof saved.scheduledAt === "string" ? saved.scheduledAt : d.scheduledAt,
        maxParticipants: typeof saved.maxParticipants === "number" ? saved.maxParticipants : d.maxParticipants,
        registrationEnabled: Boolean(saved.registrationEnabled ?? d.registrationEnabled),
        waitlistEnabled: Boolean(saved.waitlistEnabled ?? d.waitlistEnabled),
        status: typeof saved.status === "string" ? saved.status : d.status,
        eventRoleId: typeof saved.eventRoleId === "string" ? saved.eventRoleId : "",
        reminders: typeof saved.reminders === "string" ? saved.reminders : "",
        recurrenceFreq: typeof saved.recurrenceFreq === "string" ? saved.recurrenceFreq : d.recurrenceFreq,
        recurrenceInterval: typeof saved.recurrenceInterval === "number" ? saved.recurrenceInterval : d.recurrenceInterval,
        title: String(saved.title ?? ""),
        description: String(saved.description ?? ""),
        color: typeof saved.color === "string" ? saved.color : DEFAULT_ACCENT,
        footer: String(saved.footer ?? ""),
        timestamp: Boolean(saved.timestamp),
        thumbnail: "", image: "", thumbnailFile: null, imageFile: null,
        fields: Array.isArray(saved.fields) ? (saved.fields as { name?: unknown; value?: unknown; inline?: unknown }[]).map(f => ({ name: String(f?.name ?? ""), value: String(f?.value ?? ""), inline: Boolean(f?.inline) })) : [],
        joinLabel: typeof saved.joinLabel === "string" ? saved.joinLabel : d.joinLabel,
        joinEmoji: typeof saved.joinEmoji === "string" ? saved.joinEmoji : d.joinEmoji,
        joinStyle: typeof saved.joinStyle === "string" ? saved.joinStyle : d.joinStyle,
        joinEnabled: Boolean(saved.joinEnabled ?? true),
        leaveLabel: typeof saved.leaveLabel === "string" ? saved.leaveLabel : d.leaveLabel,
        leaveEmoji: typeof saved.leaveEmoji === "string" ? saved.leaveEmoji : d.leaveEmoji,
        leaveStyle: typeof saved.leaveStyle === "string" ? saved.leaveStyle : d.leaveStyle,
        leaveEnabled: Boolean(saved.leaveEnabled ?? true),
      }));
    } catch { /* malformed draft */ }
  }, [guildId]);

  const load = () => void apiGet<EventListGet>(`/api/guilds/${guildId}/events`, { events: [] }).then(data => setEvents(data.events));
  useEffect(() => { if (!guildId) return; load(); }, [guildId]);
  const editing = events?.find(e => e.id === editingId) ?? null;

  function edit(e: EventListItem) {
    const join = e.buttons.find(b => b.key === "join"), leave = e.buttons.find(b => b.key === "leave");
    setDraft({
      channelId: e.channelId, scheduledAt: toLocalInput(e.scheduledAt), maxParticipants: e.maxParticipants,
      registrationEnabled: e.registrationEnabled, waitlistEnabled: e.waitlistEnabled, status: e.status, eventRoleId: e.eventRoleId ?? "",
      reminders: e.reminders.join(", "), recurrenceFreq: e.recurrence.freq, recurrenceInterval: e.recurrence.interval,
      title: e.embed.title ?? "", description: e.embed.description ?? "", color: `#${(e.embed.color ?? 5793266).toString(16).padStart(6, "0")}`, footer: e.embed.footer?.text ?? "", timestamp: Boolean(e.embed.timestamp),
      thumbnail: e.embed.thumbnail?.url ?? "", image: e.embed.image?.url ?? "", thumbnailFile: null, imageFile: null,
      fields: (e.embed.fields ?? []).map(f => ({ name: f.name, value: f.value, inline: Boolean(f.inline) })),
      joinLabel: join?.label ?? "Участвовать", joinEmoji: join?.emoji ?? "✅", joinStyle: join?.style ?? "primary", joinEnabled: join?.enabled ?? true,
      leaveLabel: leave?.label ?? "Отказаться", leaveEmoji: leave?.emoji ?? "❌", leaveStyle: leave?.style ?? "danger", leaveEnabled: leave?.enabled ?? true,
    });
    setEditingId(e.id);
  }

  const reset = () => {
    setEditingId(null);
    setDraft(defaultEventDraft());
    try { sessionStorage.removeItem(draftKey); } catch { /* unavailable */ }
  };

  async function save(statusOverride?: string) {
    const scheduledMs = new Date(draft.scheduledAt).getTime();
    if (!Number.isFinite(scheduledMs)) return onError("Укажите дату и время события.");
    if (!draft.channelId) return onError("Выберите канал события.");
    const payload = {
      id: editingId ?? undefined, channelId: draft.channelId, scheduledAt: scheduledMs, maxParticipants: draft.maxParticipants,
      registrationEnabled: draft.registrationEnabled, waitlistEnabled: draft.waitlistEnabled, status: statusOverride ?? draft.status, eventRoleId: draft.eventRoleId || null,
      reminders: draft.reminders.split(",").map(s => Number(s.trim())).filter(v => Number.isInteger(v) && v > 0).slice(0, 10),
      recurrence: { freq: draft.recurrenceFreq, interval: draft.recurrenceInterval },
      payload: { title: draft.title, description: draft.description, color: parseInt(draft.color.slice(1), 16) || undefined, footer: { text: draft.footer }, thumbnail: { url: draft.thumbnail }, image: { url: draft.image }, fields: draft.fields.filter(f => f.name.trim() && f.value.trim()).map(f => ({ name: f.name, value: f.value, inline: f.inline })), timestamp: draft.timestamp },
      buttons: [
        { key: "join", label: draft.joinLabel, emoji: draft.joinEmoji, style: draft.joinStyle, enabled: draft.joinEnabled, order: 1 },
        { key: "leave", label: draft.leaveLabel, emoji: draft.leaveEmoji, style: draft.leaveStyle, enabled: draft.leaveEnabled, order: 2 },
      ],
    };
    const form = new FormData();
    form.set("data", JSON.stringify(payload));
    if (draft.thumbnailFile) form.set("thumbnailFile", draft.thumbnailFile);
    if (draft.imageFile) form.set("imageFile", draft.imageFile);
    await run(async () => {
      const sent = await apiSend<{ warning?: string; id?: string }>(`/api/guilds/${guildId}/events`, { method: "POST", body: form }, "Не удалось сохранить событие.");
      if (!sent.ok) return onError(sent.error);
      const result = sent.data;
      if (!editingId && result.id) setEditingId(result.id);
      setDraft(d => ({ ...d, status: statusOverride ?? d.status }));
      const okMessage = statusOverride ? `Событие переведено в «${eventStatusMeta[statusOverride]?.label ?? statusOverride}».` : editingId ? "Событие обновлено." : "Событие создано.";
      onDone(result.warning ?? okMessage, result.warning ? "warn" : undefined);
      load();
    });
  }

  async function remove(e: EventListItem) {
    if (busy) return;
    if (!(await confirmAction(`Удалить событие «${e.embed.title ?? "без названия"}»? Сообщение в Discord тоже будет удалено.`, "Удалить"))) return;
    await run(async () => {
      const result = await apiMutate(`/api/guilds/${guildId}/events?id=${e.id}`, { method: "DELETE" }, "Не удалось удалить событие.");
      if (!result.ok) return onError(result.error);
      onDone("Событие удалено.");
      if (editingId === e.id) reset();
      load();
    });
  }

  async function removeParticipant(e: EventListItem, userId: string) {
    if (busy) return;
    if (!(await confirmAction(`Удалить участника ${userId} из события?`, "Удалить"))) return;
    await run(async () => {
      const sent = await apiSend<{ promotedUserId?: string }>(`/api/guilds/${guildId}/events?id=${e.id}&participant=${userId}`, { method: "DELETE" }, "Не удалось удалить участника.");
      if (!sent.ok) return onError(sent.error);
      const result = sent.data;
      onDone(result.promotedUserId ? `Участник удалён, <@${result.promotedUserId}> переведён из очереди.` : "Участник удалён.");
      setEvents(list => (list ?? []).map(item => {
        if (item.id !== e.id) return item;
        const removed = item.participants.find(p => p.userId === userId);
        const wasWaitlist = removed?.waitlist ?? false;
        const promoted = result.promotedUserId ?? null;
        return {
          ...item,
          counts: { joined: item.counts.joined - (wasWaitlist ? 0 : 1) + (promoted ? 1 : 0), waitlist: item.counts.waitlist - (wasWaitlist ? 1 : 0) - (promoted ? 1 : 0) },
          participants: item.participants.filter(p => p.userId !== userId).map(p => p.userId === promoted ? { ...p, waitlist: false } : p),
        };
      }));
    });
  }

  const set = (change: Partial<EventDraft>) => setDraft(d => ({ ...d, ...change }));
  const setButton = (base: "join" | "leave") => (change: { label?: string; emoji?: string; style?: string; enabled?: boolean }) => {
    const keyed = Object.fromEntries(Object.entries(change).map(([k, v]) => [`${base}${k.charAt(0).toUpperCase()}${k.slice(1)}`, v])) as Partial<EventDraft>;
    set(keyed);
  };

  return (
    <section className="panel-stack">
      <TemplateLibrary
        title="События сервера"
        note={events !== null && events.length ? String(events.length) : undefined}
        description="События публикуются сообщением с кнопками «Участвовать» и «Отказаться». Участники, очередь, статус и напоминания обновляются автоматически."
        action={<button type="button" className="btn" onClick={reset}>Новое событие</button>}
        empty="Событий пока нет — создайте первое."
      >
        {events === null ? (
          <p className="muted" role="status">Загружаем события…</p>
        ) : events.length > 0 ? (
          <div className="event-list">
            {events.map(e => {
              const ch = channels.find(c => c.id === e.channelId);
              return (
                <article className="template-item event-item" key={e.id}>
                  <div>
                    <strong>{e.embed.title ?? "Без названия"}</strong>
                    <p className="muted"><span className={`pill ${EVENT_TONE[e.status] ?? ""}`}>{eventStatusMeta[e.status]?.label ?? e.status}</span> · {formatTime(e.scheduledAt)} · #{ch?.name ?? e.channelId} · {e.counts.joined}{e.maxParticipants > 0 ? ` / ${e.maxParticipants}` : ""}{e.counts.waitlist > 0 ? ` +${e.counts.waitlist} в очереди` : ""}</p>
                  </div>
                  <div className="template-actions">
                    <button type="button" className="btn secondary" disabled={busy} onClick={() => edit(e)}>Изменить</button>
                    <button type="button" className="btn danger" disabled={busy} onClick={() => void remove(e)} aria-label={`Удалить ${e.embed.title ?? "событие"}`}><Trash2 size={16}/>Удалить</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </TemplateLibrary>
      <div className="events-composer-layout">
        <section className="card settings-card">
          <CardHeader title={editingId ? "Редактирование события" : "Новое событие"}
            muted="Время указывается в вашем часовом поясе; в Discord дата отображается в формате @time у каждого читателя. Сохранение сразу обновляет сообщение."/>
          <div className="compact-form-grid">
            <label>Канал<Select value={draft.channelId} onChange={channelId => set({ channelId })} ariaLabel="Канал события" options={channelOptions(channels, "Выберите канал")}/></label>
            <label>Дата и время<input type="datetime-local" value={draft.scheduledAt} onChange={e => set({ scheduledAt: e.target.value })}/></label>
            <NumberField label="Лимит участников" hint="(0 — без лимита)" min={0} max={100000} value={draft.maxParticipants} onChange={maxParticipants => set({ maxParticipants: Math.max(0, Math.min(100000, maxParticipants || 0)) })}/>
            <label>Роль события (необязательно)<Select value={draft.eventRoleId} onChange={eventRoleId => set({ eventRoleId })} ariaLabel="Роль события"
              options={[{ value: "", label: "Без роли" }, ...roles.map(r => ({ value: r.id, label: r.name }))]}/></label>
            <label>Напоминания, минуты через запятую<input value={draft.reminders} placeholder="60, 1440, 10080" onChange={e => set({ reminders: e.target.value })}/></label>
            <label>Повторение<Select
              value={draft.recurrenceFreq}
              onChange={recurrenceFreq => set({ recurrenceFreq })}
              ariaLabel="Повторение"
              options={[
                { value: "none", label: "Без повторения" },
                { value: "daily", label: "Каждый день" },
                { value: "weekly", label: "Каждую неделю" },
                { value: "biweekly", label: "Раз в две недели" },
                { value: "custom", label: "Свой интервал" },
              ]}/></label>
            {draft.recurrenceFreq === "custom" && (
              <NumberField label="Интервал, дней" min={1} max={365} value={draft.recurrenceInterval} onChange={recurrenceInterval => set({ recurrenceInterval: Math.max(1, Math.min(365, recurrenceInterval || 1)) })}/>
            )}
          </div>
          <label className="check-row"><input type="checkbox" checked={draft.registrationEnabled} onChange={e => set({ registrationEnabled: e.target.checked })}/> Регистрация открыта</label>
          <label className="check-row"><input type="checkbox" checked={draft.waitlistEnabled} onChange={e => set({ waitlistEnabled: e.target.checked })}/> Очередь, когда места закончились</label>
          <div className="embed-form" style={{ borderLeftColor: draft.color }}>
            <ColorRow color={draft.color} onChange={color => set({ color })}/>
            <label className="check-row"><input type="checkbox" checked={draft.timestamp} onChange={e => set({ timestamp: e.target.checked })}/> Показывать дату события в сообщении (Discord @time)</label>
            <input className="embed-title-input" value={draft.title} maxLength={256} placeholder="Заголовок события" onChange={e => set({ title: e.target.value })}/>
            <textarea className="embed-description-input" rows={6} value={draft.description} maxLength={4096} placeholder="Описание: markdown, эмодзи, несколько абзацев" onChange={e => set({ description: e.target.value })}/>
            <FieldsEditor fields={draft.fields} onChange={fields => set({ fields })}/>
            <input className="embed-footer-input" value={draft.footer} maxLength={2048} placeholder="Футер" onChange={e => set({ footer: e.target.value })}/>
            <div className="embed-bottom">
              <MediaField icon={<Image size={18}/>} label="Основное изображение" file={draft.imageFile} previewUrl={imagePreview} saved={Boolean(draft.image)} onPick={file => set({ imageFile: file })} onClear={() => set({ image: "", imageFile: null })} clearLabel="Удалить изображение"/>
              <MediaField icon={<Image size={18}/>} label="Миниатюра" file={draft.thumbnailFile} previewUrl={thumbnailPreview} saved={Boolean(draft.thumbnail)} onPick={file => set({ thumbnailFile: file })} onClear={() => set({ thumbnail: "", thumbnailFile: null })} clearLabel="Удалить миниатюру"/>
            </div>
          </div>
          <div className="event-buttons-grid">
            <ButtonEditor title="Кнопка «Участвовать»" label={draft.joinLabel} emoji={draft.joinEmoji} style={draft.joinStyle} enabled={draft.joinEnabled} emojis={emojis} onChange={setButton("join")}/>
            <ButtonEditor title="Кнопка «Отказаться»" label={draft.leaveLabel} emoji={draft.leaveEmoji} style={draft.leaveStyle} enabled={draft.leaveEnabled} emojis={emojis} onChange={setButton("leave")}/>
          </div>
          <div className="template-actions">
            <SaveButton saving={busy} onClick={() => void save()} label={editingId ? "Сохранить изменения" : "Создать событие"}/>
            {editingId && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save("live")}>Начать сейчас</button>}
            {editingId && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save("completed")}>Завершить</button>}
          </div>
        </section>
        {editing && (
          <aside className="card settings-card event-participants-card">
            <CardHeader title="Участники" muted={`${editing.counts.joined} записано${editing.maxParticipants > 0 ? ` из ${editing.maxParticipants}` : ""} · ${editing.counts.waitlist} в очереди`}/>
            {editing.participants.length ? (
              <div className="event-participants">
                {editing.participants.map(p => (
                  <div className={`event-participant${p.waitlist ? " waitlist" : ""}`} key={p.userId}>
                    <div className="event-participant-main">
                      <div className="event-participant-head">
                        <span className="event-participant-name" title={p.userId}>{p.name ?? (p.userId.length > 14 ? `${p.userId.slice(0, 6)}…${p.userId.slice(-4)}` : p.userId)}</span>
                        {p.waitlist && <span className="pill pill-err">В очереди</span>}
                      </div>
                      <time className="muted">{formatTime(p.joinedAt)}</time>
                    </div>
                    <button type="button" className="btn danger small" disabled={busy} onClick={() => void removeParticipant(editing, p.userId)}>Удалить</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Пока никто не записан.</p>
            )}
            {editing.stats && (
              <div className="event-stats">
                <h3>Итоги события</h3>
                <div className="event-stats-grid">
                  <span>Записалось<strong>{String(editing.stats.registered ?? "—")}</strong></span>
                  <span>Участников<strong>{String(editing.stats.participants ?? "—")}</strong></span>
                  <span>В очереди<strong>{String(editing.stats.waitlist ?? "—")}</strong></span>
                  <span>Лимит<strong>{String(editing.stats.maxParticipants ?? "—")}</strong></span>
                  <span>Началось<strong>{typeof editing.stats.startedAt === "number" ? formatTime(editing.stats.startedAt) : "—"}</strong></span>
                  <span>Завершено<strong>{typeof editing.stats.completedAt === "number" ? formatTime(editing.stats.completedAt) : "—"}</strong></span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
