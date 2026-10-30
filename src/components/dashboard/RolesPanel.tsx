"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { buttonColorOptionsList, type EmbedDto, type EmbedSendingDto, type EmbedsGetDto, type Role, type RolePanelRowDto, type SavedRolePanel, type ServerEmoji } from "./types.ts";
import { roleStyleLabels } from "../../lib/labels.ts";
import { CardHeader, confirmAction, EmojiPicker, SaveButton, Select, TemplateLibrary, formatTime } from "./ui.tsx";
import { apiGet, apiMutate, apiSend } from "./api.ts";
import { useApiResource, usePanelAction } from "./hooks.ts";
import { useDashboard } from "./DashboardContext.tsx";

type PanelOptionInput = { roleId: string; label: string; emoji: string; buttonColor: string };
const defaultPanelOption = { roleId: "", label: "", emoji: "", buttonColor: "primary" };

function RoleOptionRow({ option, index, roles, emojis, style, onChange, onRemove, removable }: { option: PanelOptionInput; index: number; roles: Role[]; emojis: ServerEmoji[]; style: "buttons" | "select" | "reaction"; onChange: (change: Partial<PanelOptionInput>) => void; onRemove: () => void; removable: boolean }) {
  return (
    <div className="role-option">
      <label>
        Роль
        <Select
          value={option.roleId}
          onChange={roleId => onChange({ roleId })}
          ariaLabel={`Роль ${index + 1}`}
          placeholder={roles.length ? "Выберите роль" : "Нет доступных ролей"}
          options={roles.map(r => ({ value: r.id, label: r.name }))}/>
      </label>
      {style !== "reaction" && (
        <label>
          Подпись
          <input value={option.label} onChange={e => onChange({ label: e.target.value })} placeholder={style === "buttons" ? "Надпись на кнопке" : "Название пункта"}/>
        </label>
      )}
      <div className="role-emoji-field">
        <span className="field-label">Эмодзи</span>
        <EmojiPicker value={option.emoji} onChange={emoji => onChange({ emoji })} serverEmojis={emojis}/>
      </div>
      {style === "buttons" && (
        <label>
          Цвет кнопки
          <Select value={option.buttonColor} onChange={buttonColor => onChange({ buttonColor })} ariaLabel="Цвет кнопки"
            options={buttonColorOptionsList}/>
        </label>
      )}
      <button type="button" className="btn danger" disabled={!removable} onClick={onRemove} aria-label={`Удалить роль ${index + 1}`}>Удалить</button>
    </div>
  );
}

export function RoleSettings() {
  const { guildId, resources, notify: onDone, fail: onError } = useDashboard();
  const roles = resources?.roles ?? [];
  const emojis = resources?.emojis ?? [];
  const channels = resources?.channels ?? [];
  const { data: { embeds, sendings, panels }, reload } = useApiResource(
    Boolean(guildId),
    async (signal) => {
      const [embedData, rows] = await Promise.all([
        apiGet<EmbedsGetDto>(`/api/guilds/${guildId}/embeds`, { embeds: [], sendings: [] }, signal),
        apiGet<RolePanelRowDto[]>(`/api/guilds/${guildId}/roles`, [], signal),
      ]);
      const map = new Map<number, SavedRolePanel>();
      for (const row of rows) {
        let panel = map.get(row.id);
        if (!panel) {
          panel = { id: row.id, channelId: row.channelId ?? "", messageId: row.messageId ?? "", title: row.title ?? "", style: row.style === "reaction" || row.style === "select" ? row.style : "buttons", roleLimit: row.roleLimit, roleMode: row.roleMode, notifyEnabled: row.notifyEnabled, notifyTemplate: row.notifyTemplate ?? "", options: [] };
          map.set(row.id, panel);
        }
        if (row.roleId) panel.options.push({ roleId: row.roleId, label: row.label ?? null, emoji: row.emoji ?? null, buttonColor: row.buttonColor ?? "primary" });
      }
      return { embeds: embedData.embeds, sendings: embedData.sendings, panels: [...map.values()] };
    },
    [guildId],
    { embeds: [] as EmbedDto[], sendings: [] as EmbedSendingDto[], panels: [] as SavedRolePanel[] },
  );
  const { busy, run } = usePanelAction({ onDone, onError });
  const [panelId, setPanelId] = useState<number | undefined>();
  const [sendingId, setSendingId] = useState("");
  const [options, setOptions] = useState<PanelOptionInput[]>([defaultPanelOption]);
  const [style, setStyle] = useState<"buttons" | "select" | "reaction">("buttons");
  const [limit, setLimit] = useState(0);
  const [mode, setMode] = useState("toggle");
  const [notify, setNotify] = useState(true);
  const [template, setTemplate] = useState("✅ Выдана роль **{role}**");

  const updateOption = (index: number, change: Partial<PanelOptionInput>) => setOptions(options.with(index, { ...options[index]!, ...change }));

  function edit(panel: SavedRolePanel) {
    setPanelId(panel.id);
    const matched = sendings.find(s => s.channelId === panel.channelId && s.messageId === panel.messageId);
    setSendingId(matched ? String(matched.id) : "");
    setOptions(panel.options.length ? panel.options.map(o => ({ roleId: o.roleId, label: o.label ?? "", emoji: o.emoji ?? "", buttonColor: o.buttonColor ?? "primary" })) : [defaultPanelOption]);
    setStyle(panel.style);
    setLimit(panel.roleLimit);
    setMode(panel.roleMode);
    setNotify(panel.notifyEnabled);
    setTemplate(panel.notifyTemplate);
  }

  function reset() {
    setPanelId(undefined);
    setSendingId("");
    setOptions([defaultPanelOption]);
    setStyle("buttons");
    setLimit(0);
    setMode("toggle");
    setNotify(true);
    setTemplate("✅ Выдана роль **{role}**");
  }

  async function remove(panel: SavedRolePanel) {
    if (!(await confirmAction(`Удалить панель «${panel.title}»? Бот постарается снять кнопки и реакции с сообщения в Discord.`, "Удалить"))) return;
    await run(
      () => apiSend<{ warning?: string }>(`/api/guilds/${guildId}/roles?id=${panel.id}`, { method: "DELETE" }, "Не удалось удалить панель."),
      data => {
        if (panelId === panel.id) reset();
        return { message: data.warning ?? "Панель самовыдачи удалена.", ...(data.warning ? { tone: "warn" as const } : {}) };
      },
      reload,
    );
  }

  async function publish() {
    const sending = sendings.find(x => x.id === Number(sendingId));
    if (!sending) return onError("Выберите отправленное сообщение.");
    if (!options.some(o => o.roleId)) return onError("Добавьте хотя бы одну роль.");
    await run(
      () => apiMutate(`/api/guilds/${guildId}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panelId, embedId: sending.embedId, channelId: sending.channelId, messageId: sending.messageId, style, roleLimit: limit, roleMode: mode, notifyEnabled: notify, notifyTemplate: template, options }),
      }, "Не удалось сохранить панель."),
      () => {
        const message = panelId ? "Панель самовыдачи обновлена." : "Панель самовыдачи сохранена.";
        reset();
        return { message };
      },
      reload,
    );
  }

  return (
    <section className="panel-stack">
      <TemplateLibrary
        title="Панели самовыдачи"
        note={panels.length ? String(panels.length) : undefined}
        description="Готовые панели работают в Discord: кнопки, меню выбора или реакции на одном сообщении."
        empty="Панелей пока нет — создайте первую ниже."
      >
        {panels.length > 0 ? (
          <div className="template-list">
            {panels.map(panel => (
              <article className="template-item" key={panel.id}>
                <div>
                  <strong>{panel.title}</strong>
                  <p className="muted">{roleStyleLabels[panel.style]} · {panel.options.length} ролей</p>
                </div>
                <div className="template-actions">
                  <button type="button" className="btn secondary" onClick={() => edit(panel)}>Изменить</button>
                  <button type="button" className="btn danger" onClick={() => void remove(panel)} aria-label={`Удалить панель ${panel.title}`}><Trash2 size={16}/>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </TemplateLibrary>
      <section className="card settings-card">
        <CardHeader title={panelId ? "Редактирование панели" : "Новая панель самовыдачи"}
          muted="Выберите сообщение, добавьте роли и эмодзи. Для кнопок можно задать цвет, для меню выбора — несколько ролей, для реакций подпись не нужна."
          action={panelId && <button type="button" className="btn secondary" onClick={reset}>Новый</button>}/>
        <label>Отправленное сообщение<Select
          value={sendingId}
          onChange={setSendingId}
          ariaLabel="Отправленное сообщение"
          placeholder="Выберите сообщение"
          options={[{ value: "", label: "Выберите сообщение" }, ...sendings.map(s => {
            const embed = embeds.find(e => e.id === s.embedId);
            const ch = channels.find(c => c.id === s.channelId);
            return { value: String(s.id), label: `${embed?.name ?? "Embed"} · #${ch?.name ?? s.channelId} · ${formatTime(s.sentAt)}` };
          })]}/></label>
        <label>Тип<Select
          value={style}
          onChange={value => setStyle(value as typeof style)}
          ariaLabel="Тип панели"
          options={[{ value: "buttons", label: "Кнопка" }, { value: "select", label: "Меню выбора" }, { value: "reaction", label: "Реакция" }]}/></label>
        <div>
          <span className="field-label">Роли</span>
          <div className="role-options">
            {options.map((option, index) => (
              <RoleOptionRow
                key={index}
                option={option}
                index={index}
                roles={roles}
                emojis={emojis}
                style={style}
                onChange={change => updateOption(index, change)}
                onRemove={() => setOptions(options.filter((_, n) => n !== index))}
                removable={options.length > 1}
              />
            ))}
          </div>
          <button type="button" className="btn secondary" onClick={() => setOptions([...options, defaultPanelOption])}>Добавить роль</button>
        </div>
        <label>Лимит ролей: {limit || "без лимита"}<input type="range" min="0" max="25" value={limit} onChange={e => setLimit(Number(e.target.value))} aria-label="Лимит ролей"/></label>
        <p className="hint">Лимит определяет, сколько ролей из этой панели участник может иметь одновременно (0 — без лимита).</p>
        <label>Режим<Select
          value={mode}
          onChange={setMode}
          ariaLabel="Режим выдачи"
          options={[{ value: "toggle", label: "Переключить" }, { value: "add", label: "Выдать" }, { value: "remove", label: "Забрать" }]}/></label>
        <label className="check-row"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)}/> Уведомлять пользователя</label>
        {notify && (
          <label>Текст уведомления<input value={template} onChange={e => setTemplate(e.target.value)}/></label>
        )}
        <div className="template-actions">
          <SaveButton saving={busy} disabled={!roles.length} onClick={() => void publish()} label={panelId ? "Сохранить изменения" : "Сохранить панель"}/>
          {panelId && <button type="button" className="btn secondary" onClick={reset}>Новая панель</button>}
        </div>
      </section>
    </section>
  );
}
