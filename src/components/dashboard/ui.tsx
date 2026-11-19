"use client";

import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { stripVariationSelectors } from "goemoji/discord";
import { ArrowDown, ArrowRight, Check, ChevronDown, Image, Smile, User } from "lucide-react";
import { COLOR_PRESETS, type Channel, type EmbedField, type ServerEmoji } from "./types.ts";
import { safeJson } from "../../lib/json.ts";
import { EMBED_LIMITS } from "#contracts/embeds.ts";

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="card settings-card" role="alert">
    <p className="error-note">⚠ {message}</p>
    <button type="button" className="btn secondary" onClick={onRetry}>Повторить</button>
  </div>;
}

export function channelOptions(channels: Channel[], emptyLabel: string) {
  return [{ value: "", label: emptyLabel }, ...channels.map(c => ({ value: c.id, label: `# ${c.name}` }))];
}

export function ColorRow({ color, onChange, label = "Цвет", presets = true }: { color: string; onChange: (color: string) => void; label?: string; presets?: boolean }) {
  return (
    <div className="color-field">
      <span>{label}</span>
      {presets && <div className="color-presets">
        {COLOR_PRESETS.map(preset => (
          <button key={preset} type="button" className={`color-preset ${color === preset ? "active" : ""}`} style={{ background: preset }} onClick={() => onChange(preset)} aria-label={`Цвет ${preset}`}/>
        ))}
      </div>}
      <span className="color-swatch" style={{ background: color }} title={color}>
        <input type="color" value={color} onChange={e => onChange(e.target.value)} aria-label={label}/>
      </span>
      <code>{color}</code>
    </div>
  );
}

function FieldsEditor({ fields, onChange }: { fields: EmbedField[]; onChange: (fields: EmbedField[]) => void }) {
  return (
    <div className="embed-fields">
      <div className="section-title"><strong>Поля</strong></div>
      {fields.map((field, index) => (
        <div className="field-row-simple" key={index}>
          <input value={field.name} maxLength={EMBED_LIMITS.fieldName} placeholder="Заголовок" onChange={e => onChange(fields.with(index, { ...field, name: e.target.value }))}/>
          <textarea rows={2} value={field.value} maxLength={EMBED_LIMITS.fieldValue} placeholder="Текст" onChange={e => onChange(fields.with(index, { ...field, value: e.target.value }))}/>
          <div className="field-actions">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => onChange(fields.with(index, { ...field, inline: !field.inline }))}
              title={field.inline ? "Поле в одну строку — идёт вбок. Нажмите, чтобы поставить в столбик." : "Поле столбиком — идёт вниз. Нажмите, чтобы поставить в одну строку."}
              aria-label={field.inline ? "Поле в одну строку" : "Поле столбиком"}
            >
              {field.inline ? <ArrowRight size={16}/> : <ArrowDown size={16}/>}
            </button>
            <button type="button" className="btn danger small" onClick={() => onChange(fields.filter((_, n) => n !== index))}>Удалить</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn secondary" disabled={fields.length >= EMBED_LIMITS.fields} onClick={() => onChange([...fields, { name: "", value: "", inline: false }])}>Добавить поле</button>
    </div>
  );
}

type EmbedFieldsValue = { title: string; description: string; footer: string; fields: EmbedField[] };

function EmbedTextUsage({ value }: { value: string }) {
  const used = value.length;
  const max = EMBED_LIMITS.description;
  return <div className={used > max * .9 ? "embed-usage is-near" : "embed-usage"} aria-label={`Использовано ${used} из ${max} символов основного текста`}>
    <div className="embed-usage-head"><span>Основной текст</span><output>{used} / {max}</output></div>
    <div className="embed-usage-track"><i style={{ width: `${Math.min(100, used / max * 100)}%` }}/></div>
  </div>;
}

function EmbedFields({ value, onChange }: { value: EmbedFieldsValue; onChange: (patch: Partial<EmbedFieldsValue>) => void }) {
  return <>
    <input className="embed-title-input" value={value.title} maxLength={EMBED_LIMITS.title} placeholder="Заголовок" onChange={e => onChange({ title: e.target.value })}/>
    <textarea className="embed-description-input" rows={6} value={value.description} maxLength={EMBED_LIMITS.description} placeholder="Описание" onChange={e => onChange({ description: e.target.value })}/>
    <EmbedTextUsage value={value.description}/>
    <FieldsEditor fields={value.fields} onChange={fields => onChange({ fields })}/>
    <input className="embed-footer-input" value={value.footer} maxLength={EMBED_LIMITS.footer} placeholder="Футер" onChange={e => onChange({ footer: e.target.value })}/>
  </>;
}

type EmbedMediaSlot = {
  file: File | null;
  preview: string;
  saved: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onPick: (file: File | null) => void;
  onClear: () => void;
};

function EmbedMediaFields({ image, thumbnail }: { image: EmbedMediaSlot; thumbnail: EmbedMediaSlot }) {
  return <div className="embed-bottom">
    <MediaField icon={<Image size={18}/>} label="Основное изображение" file={image.file} previewUrl={image.preview} saved={image.saved} onPick={image.onPick} onClear={image.onClear} {...(image.inputRef ? { ref: image.inputRef } : {})} clearLabel="Удалить изображение"/>
    <MediaField icon={<Image size={18}/>} label="Миниатюра" file={thumbnail.file} previewUrl={thumbnail.preview} saved={thumbnail.saved} onPick={thumbnail.onPick} onClear={thumbnail.onClear} {...(thumbnail.inputRef ? { ref: thumbnail.inputRef } : {})} clearLabel="Удалить миниатюру"/>
  </div>;
}

type EmbedAuthorEditor = {
  name: string;
  url: string;
  icon: EmbedMediaSlot;
  onChange: (patch: { name?: string; url?: string }) => void;
};

type EmbedComposerProps = {
  color: string;
  onColorChange: (color: string) => void;
  value: EmbedFieldsValue;
  onChange: (patch: Partial<EmbedFieldsValue>) => void;
  image: EmbedMediaSlot;
  thumbnail: EmbedMediaSlot;
  author?: EmbedAuthorEditor;
  timestamp?: { checked: boolean; onChange: (checked: boolean) => void };
};

export function EmbedComposer({ color, onColorChange, value, onChange, image, thumbnail, author, timestamp }: EmbedComposerProps) {
  return <div className="embed-form" style={{ borderLeftColor: color }}>
    <ColorRow color={color} onChange={onColorChange}/>
    {timestamp && <label className="check-row"><input type="checkbox" checked={timestamp.checked} onChange={event => timestamp.onChange(event.target.checked)}/> Показывать дату события в сообщении (Discord @time)</label>}
    {author && <div className="embed-author-row">
      <input value={author.name} maxLength={EMBED_LIMITS.authorName} placeholder="Имя автора" onChange={event => author.onChange({ name: event.target.value })}/>
      {author.name && (
        <>
          <input value={author.url} maxLength={EMBED_LIMITS.url} placeholder="Ссылка автора https://…" onChange={event => author.onChange({ url: event.target.value })}/>
          <MediaField icon={<User size={18}/>} label="Иконка автора" file={author.icon.file} previewUrl={author.icon.preview} saved={author.icon.saved} onPick={author.icon.onPick} onClear={author.icon.onClear} {...(author.icon.inputRef ? { ref: author.icon.inputRef } : {})}/>
        </>
      )}
    </div>}
    <EmbedFields value={value} onChange={onChange}/>
    <EmbedMediaFields image={image} thumbnail={thumbnail}/>
  </div>;
}

export { formatNumber, formatTime } from "../../lib/format.ts";

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async (action: () => unknown) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { return await action(); } finally { busyRef.current = false; setBusy(false); }
  };
  return { busy, run };
}

const writeSessionDraft = (key: string, value: unknown) => {
  try { sessionStorage.setItem(key, JSON.stringify(value, (_key, item) => item instanceof File ? undefined : item)); } catch {  }
};

export function useSessionDraft(key: string, enabled: boolean, deps: readonly unknown[], value: () => unknown): void {
  const write = useEffectEvent(() => { if (enabled) writeSessionDraft(key, value()); });
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(write, 400);
    return () => clearTimeout(timer);
  }, [key, enabled, ...deps]);
  useEffect(() => () => write(), []);
}

export function useSessionDraftRestore(key: string, apply: (saved: Record<string, unknown>) => void): void {
  const applyEvent = useEffectEvent(apply);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = safeJson<Record<string, unknown>>(raw, {});
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      applyEvent(saved);
    } catch {  }
  }, [key]);
}

export const asString = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
export const asNumber = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const asBoolean = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
export const asFields = (value: unknown): EmbedField[] => Array.isArray(value)
  ? value.map(field => {
    const item = (field ?? {}) as { name?: unknown; value?: unknown; inline?: unknown };
    return { name: asString(item.name), value: asString(item.value), inline: Boolean(item.inline) };
  })
  : [];

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return <article className="card stat-card"><span>{label}</span><strong>{value}</strong>{hint != null && <small>{hint}</small>}</article>;
}

export function SaveButton({ saving, onClick, label = "Сохранить", disabled = false, savingLabel = "Сохраняем…" }: { saving: boolean; onClick: () => void; label?: string; disabled?: boolean; savingLabel?: string }) {
  return <button type="button" className="btn success" disabled={disabled || saving} onClick={onClick}>{saving ? savingLabel : label}</button>;
}

type CheckListProps = {
  items: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  channel?: boolean;
  label?: string;
};

export function NumberField({ label, hint, value, min, max, onChange }: { label: ReactNode; hint?: string; value: number; min: number; max?: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      {hint && <span className="muted"> {hint}</span>}
      <input type="number" min={min} {...(max !== undefined ? { max } : {})} value={value} onChange={e => onChange(Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : min)}/>
    </label>
  );
}

export function CheckList({ items, selected, onChange, channel = false, label }: CheckListProps) {
  const selectedSet = new Set(selected);
  const toggle = (id: string) => onChange(
    selectedSet.has(id) ? selected.filter(value => value !== id) : [...selected, id],
  );
  return (
    <div className="choice-list" role="group" aria-label={label}>
      {items.length ? items.map(item => {
        const active = selectedSet.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            className={active ? "choice-item selected" : "choice-item"}
            onClick={() => toggle(item.id)}
          >
            <span className="choice-check" aria-hidden="true">{active && <Check size={14} />}</span>
            <span>{channel ? "# " : ""}{item.name}</span>
          </button>
        );
      }) : <span className="hint">Нет доступных вариантов.</span>}
    </div>
  );
}

const EmojiPickerBody = lazy(() => import("./EmojiPickerBody.tsx"));

type PopoverCoords = { left: number; width: number; top?: number; bottom?: number };

const placeEmojiPopover = (rect: DOMRect): PopoverCoords => {
  const width = Math.min(340, window.innerWidth - 24);
  // Center the picker under the emoji trigger, not under the whole input row.
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const upwards = below < Math.min(360, window.innerHeight * 0.6) && above > below;
  return { left, width, ...(upwards ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) };
};

const placeSelectPopover = (rect: DOMRect): PopoverCoords => {
  const spaceBelow = window.innerHeight - rect.bottom;
  const willFlip = spaceBelow < Math.min(300, window.innerHeight / 2);
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
    width: rect.width,
    ...(willFlip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };
};

function useFloatingPopover(options: {
  anchorRef: RefObject<HTMLElement | null>;
  rootRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  place: (rect: DOMRect) => PopoverCoords;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const close = useCallback(() => { setOpen(false); setCoords(null); }, []);
  const openPopover = useCallback(() => {
    const rect = options.anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords(options.place(rect));
    setOpen(true);
  }, [options.anchorRef, options.place]);
  useEffect(() => {
    if (!open) return;
    const { rootRef, popoverRef } = options;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    };
    const onScrollOrResize = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(document.activeElement)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close, options.rootRef, options.popoverRef]);
  return { open, coords, close, openPopover };
}

export function EmojiPicker({value,onChange,serverEmojis}:{value:string;onChange:(value:string)=>void;serverEmojis:ServerEmoji[]}) {
  const rootRef=useRef<HTMLDivElement>(null);
  const anchorRef=useRef<HTMLButtonElement>(null);
  const popoverRef=useRef<HTMLDivElement>(null);
  const { open, coords, close, openPopover } = useFloatingPopover({ anchorRef, rootRef, popoverRef, place: placeEmojiPopover });
  const select=(emoji:string)=>{onChange(stripVariationSelectors(emoji));close();};
  return (
    <div className="emoji-picker" ref={rootRef}>
      <div className="emoji-current">
        <div className="emoji-input-wrap">
          <input value={value} maxLength={96} onChange={e => onChange(e.target.value)} placeholder="Выберите эмодзи" aria-label="Эмодзи"/>
          <button type="button" ref={anchorRef} className="emoji-trigger" onClick={() => open ? close() : openPopover()} aria-expanded={open} aria-label="Выбрать эмодзи" title="Выбрать эмодзи">
            <Smile size={16}/>
          </button>
          {open&&coords&&createPortal(
            <div ref={popoverRef} className="emoji-popover emoji-popover-floating" style={{left:coords.left,width:coords.width,...(coords.top!==undefined?{top:coords.top}:{bottom:coords.bottom})}}>
              <Suspense fallback={<p className="emoji-note">Загружаем эмодзи…</p>}>
                <EmojiPickerBody serverEmojis={serverEmojis} onSelect={select} onEscape={close}/>
              </Suspense>
            </div>, document.body)}
        </div>
      </div>
    </div>
  );
}

export function useDismissOnOutside<T extends HTMLElement>(ref: RefObject<T | null>, open: boolean, onClose: () => void): void {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [ref, open]);
}

export function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function CardHeader({ title, note, muted, action }: { title: ReactNode; note?: ReactNode; muted?: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}{note != null && <span className="toolbar-note">{note}</span>}</h2>
        {muted != null && <p className="muted">{muted}</p>}
      </div>
      {action}
    </div>
  );
}

export function TemplateRow({ children, actions, className }: { children: ReactNode; actions: ReactNode; className?: string }) {
  return (
    <article className={className ? `template-item ${className}` : "template-item"}>
      <div>{children}</div>
      <div className="template-actions">{actions}</div>
    </article>
  );
}

export function TemplateLibrary<T>({ title, description, action, extra, empty, items, listClassName = "template-list", children }: { title: string; description: string; action?: ReactNode; extra?: ReactNode; empty: string; items: readonly T[]; listClassName?: string; children: (item: T) => ReactNode }) {
  return (
    <article className="card settings-card">
      <CardHeader title={title} note={items.length ? String(items.length) : undefined} muted={description} action={action}/>
      {extra}
      {items.length > 0 ? <div className={listClassName}>{items.map(children)}</div> : <p className="muted">{empty}</p>}
    </article>
  );
}

function MediaField({ icon, label, file, previewUrl, saved, onPick, onClear, ref, clearLabel = "Удалить" }: { icon: ReactNode; label: string; file: File | null; previewUrl: string; saved: boolean; onPick: (file: File | null) => void; onClear: () => void; ref?: React.Ref<HTMLInputElement>; clearLabel?: string }) {
  return (
    <label className="media-upload">
      {icon}
      <span>{label}</span>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => onPick(e.target.files?.[0] ?? null)}/>
      <em>{file?.name ?? (saved ? "Сохранено — заменить" : "PNG, JPG, GIF")}</em>
      {previewUrl && <img className="media-preview" src={previewUrl} alt=""/>}
      {(saved || file) && <button type="button" className="btn danger small media-remove" onClick={onClear} aria-label={`${clearLabel}: ${label}`}>{clearLabel}</button>}
    </label>
  );
}

export function Select({ value, onChange, options, ariaLabel, placeholder, disabled }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; ariaLabel: string; placeholder?: string | undefined; disabled?: boolean | undefined }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const { open, coords, close, openPopover } = useFloatingPopover({ anchorRef: triggerRef, rootRef, popoverRef: listRef, place: placeSelectPopover });
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus());
  }, [open]);

  const focusOption = (offset: number | "first" | "last") => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>(".select-option") ?? [])];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = offset === "first" ? 0 : offset === "last" ? items.length - 1 : (current + offset + items.length) % items.length;
    items[next]?.focus();
  };
  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); focusOption(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusOption(-1); }
    else if (event.key === "Home") { event.preventDefault(); focusOption("first"); }
    else if (event.key === "End") { event.preventDefault(); focusOption("last"); }
    else if (event.key === "Escape") { event.preventDefault(); close(); triggerRef.current?.focus(); }
  };

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); open ? close() : openPopover(); }}
        onKeyDown={e => {
          if ((e.key === "Enter" || e.key === " ") && !open) { e.preventDefault(); openPopover(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openPopover(); }
        }}
      >
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={16} className="chevron"/>
      </button>
      {open && coords && createPortal(
        <div
          className="select-popover"
          role="listbox"
          aria-label={ariaLabel}
          ref={listRef}
          style={{ left: coords.left, width: coords.width, ...(coords.bottom !== undefined ? { bottom: coords.bottom } : coords.top !== undefined ? { top: coords.top } : {}) }}
          onKeyDown={onListKeyDown}
        >
          {options.length
            ? options.map(option => (
                <button
                  key={option.value || "∅"}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={option.value === value ? "select-option selected" : "select-option"}
                  onClick={() => { onChange(option.value); close(); triggerRef.current?.focus(); }}
                >
                  <Check size={14}/><span>{option.label}</span>
                </button>
              ))
            : <div className="select-empty">Нет вариантов</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

const modalStack: symbol[] = [];

export function ModalShell({ labelledBy, onClose, children }: { labelledBy: string; onClose?: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const close = useEffectEvent(() => onClose?.());
  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const at = modalStack.indexOf(id);
      if (at !== -1) modalStack.splice(at, 1);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, []);
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy}><div ref={dialogRef} className="modal">{children}</div></div>;
}

type ConfirmTone = "default" | "danger";
type ConfirmItem = { message: string; confirmLabel: string; tone: ConfirmTone; resolve: (ok: boolean) => void };
let queue: ConfirmItem[] = [];
const subscribers = new Set<() => void>();
const emit = () => { for (const subscriber of subscribers) subscriber(); };
const EMPTY_QUEUE: ConfirmItem[] = [];
const subscribeConfirms = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback); }; };
const getConfirmSnapshot = () => queue;
const getConfirmServerSnapshot = () => EMPTY_QUEUE;

const DESTRUCTIVE_LABEL = /удали|убра|стереть|сотр|очист/i;

export function confirmAction(message: string, confirmLabel = "Подтвердить"): Promise<boolean> {
  return new Promise(resolve => {
    const item: ConfirmItem = { message, confirmLabel, tone: DESTRUCTIVE_LABEL.test(confirmLabel) ? "danger" : "default", resolve };
    queue = [...queue, item];
    emit();
  });
}

export function ConfirmHost() {
  const items = useSyncExternalStore(subscribeConfirms, getConfirmSnapshot, getConfirmServerSnapshot);
  useEffect(() => () => {
    const pending = queue;
    queue = [];
    emit();
    for (const item of pending) item.resolve(false);
  }, []);
  const current = items[0];
  const close = (ok: boolean) => {
    if (!current) return;
    queue = queue.filter(item => item !== current);
    emit();
    current.resolve(ok);
  };
  if (!current) return null;
  return <ModalShell labelledBy="confirm-dialog-title" onClose={() => close(false)}>
    <h2 id="confirm-dialog-title">Подтвердите действие</h2>
    <p className="muted">{current.message}</p>
    <div className="modal-actions">
      <button type="button" className={current.tone === "danger" ? "btn danger" : "btn"} onClick={() => close(true)}>{current.confirmLabel}</button>
      <button type="button" data-autofocus className="btn secondary" onClick={() => close(false)}>Отмена</button>
    </div>
  </ModalShell>;
}
