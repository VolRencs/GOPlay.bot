"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowRight, Check, ChevronDown } from "lucide-react";
import { COLOR_PRESETS, type Channel, type ServerEmoji } from "./types.ts";

export function channelOptions(channels: Channel[], emptyLabel: string) {
  return [{ value: "", label: emptyLabel }, ...channels.map(c => ({ value: c.id, label: `# ${c.name}` }))];
}

export function ColorRow({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <div className="color-field">
      <span>Цвет</span>
      <div className="color-presets">
        {COLOR_PRESETS.map(preset => (
          <button key={preset} type="button" className={`color-preset ${color === preset ? "active" : ""}`} style={{ background: preset }} onClick={() => onChange(preset)} aria-label={`Цвет ${preset}`}/>
        ))}
      </div>
      <span className="color-swatch" style={{ background: color }} title={color}>
        <input type="color" value={color} onChange={e => onChange(e.target.value)} aria-label="Свой цвет"/>
      </span>
      <code>{color}</code>
    </div>
  );
}

type EmbedField = { name: string; value: string; inline: boolean };

export function FieldsEditor({ fields, onChange }: { fields: EmbedField[]; onChange: (fields: EmbedField[]) => void }) {
  return (
    <div className="embed-fields">
      <div className="section-title"><strong>Поля</strong></div>
      {fields.map((field, index) => (
        <div className="field-row field-row-simple" key={index}>
          <input value={field.name} maxLength={256} placeholder="Заголовок" onChange={e => onChange(fields.map((item, n) => n === index ? { ...item, name: e.target.value } : item))}/>
          <textarea rows={2} value={field.value} maxLength={1024} placeholder="Текст" onChange={e => onChange(fields.map((item, n) => n === index ? { ...item, value: e.target.value } : item))}/>
          <div className="field-actions">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => onChange(fields.map((item, n) => n === index ? { ...item, inline: !item.inline } : item))}
              title={field.inline ? "Поле в одну строку — идёт вбок. Нажмите, чтобы поставить в столбик." : "Поле столбиком — идёт вниз. Нажмите, чтобы поставить в одну строку."}
              aria-label={field.inline ? "Поле в одну строку" : "Поле столбиком"}
            >
              {field.inline ? <ArrowRight size={16}/> : <ArrowDown size={16}/>}
            </button>
            <button type="button" className="btn danger small" onClick={() => onChange(fields.filter((_, n) => n !== index))}>Удалить</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={() => onChange([...fields, { name: "", value: "", inline: false }])}>Добавить поле</button>
    </div>
  );
}

export const formatTime = (ts: number) => new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => Array.isArray(item) && item.every(entry => typeof entry === "string") ? [...item].sort() : item);
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async (action: () => unknown) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await action(); } finally { busyRef.current = false; setBusy(false); }
  };
  return { busy, run };
}

export function CheckList({items,selected,onChange,channel=false,label}:{items:{id:string;name:string}[];selected:string[];onChange:(ids:string[])=>void;channel?:boolean;label?:string}) { const toggle=(id:string)=>onChange(selected.includes(id)?selected.filter(value=>value!==id):[...selected,id]); return <div className="choice-list" role="group" aria-label={label}>{items.length?items.map(item=><button type="button" aria-pressed={selected.includes(item.id)} className={selected.includes(item.id)?"choice-item selected":"choice-item"} key={item.id} onClick={()=>toggle(item.id)}><span className="choice-check" aria-hidden="true">{selected.includes(item.id)&&<Check size={14}/>}</span><span>{channel?"# ":""}{item.name}</span></button>):<span className="hint">Нет доступных вариантов.</span>}</div>; }

import { EmojiPicker as FrimoussePicker, type EmojiPickerListCategoryHeaderProps, type EmojiPickerListEmojiProps, type EmojiPickerListRowProps } from "frimousse";

function PickerRow({ children, ...props }: EmojiPickerListRowProps) {
  return <div {...props} className="ep-row">{children}</div>;
}

function PickerEmoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return <button {...props} className="ep-emoji">{emoji.emoji}</button>;
}

function PickerHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return <div {...props} className="ep-header">{category.label}</div>;
}

function ServerEmojiGrid({ serverEmojis, onSelect }: { serverEmojis: ServerEmoji[]; onSelect: (emoji: string) => void }) {
  if (!serverEmojis.length) return null;
  return (
    <div className="ep-server">
      <div className="ep-header">Сервер</div>
      <div className="ep-server-grid">
        {serverEmojis.map(emoji => (
          <button key={emoji.id} type="button" className="ep-server-emoji" title={emoji.name} aria-label={emoji.name}
            onClick={() => onSelect(emoji.value)}>
            <img src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=48`} alt="" loading="lazy"/>
          </button>
        ))}
      </div>
    </div>
  );
}

function UnicodeEmojiPicker({ onSelect, serverEmojis }: { onSelect: (emoji: string) => void; serverEmojis: ServerEmoji[] }) {
  return (
    <FrimoussePicker.Root className="ep-root" columns={8} onEmojiSelect={emoji => onSelect(emoji.emoji)}>
      <div className="ep-search-row">
        <FrimoussePicker.Search className="ep-search" placeholder="Найти эмодзи…"/>
        <FrimoussePicker.SkinToneSelector className="ep-tone" aria-label="Тон эмодзи"/>
      </div>
      <ServerEmojiGrid serverEmojis={serverEmojis} onSelect={onSelect}/>
      <FrimoussePicker.Viewport className="ep-viewport">
        <FrimoussePicker.Loading className="ep-note">Загружаем эмодзи…</FrimoussePicker.Loading>
        <FrimoussePicker.Empty className="ep-note">Ничего не найдено</FrimoussePicker.Empty>
        <FrimoussePicker.List className="ep-list" components={{ Row: PickerRow, Emoji: PickerEmoji, CategoryHeader: PickerHeader }}/>
      </FrimoussePicker.Viewport>
    </FrimoussePicker.Root>
  );
}

export function EmojiPicker({value,onChange,serverEmojis}:{value:string;onChange:(value:string)=>void;serverEmojis:ServerEmoji[]}) {
  const [open,setOpen]=useState(false);
  const [placement,setPlacement]=useState<"bottom"|"top">("bottom");
  const rootRef=useRef<HTMLDivElement>(null);
  const anchorRef=useRef<HTMLDivElement>(null);
  const toggle=()=>setOpen(prev=>{
    const next=!prev;
    if(next){
      const rect=anchorRef.current?.getBoundingClientRect();
      // Больше места сверху — раскрываем вверх: popover у края страницы иначе
      // растянул бы документ.
      if(rect)setPlacement(window.innerHeight-rect.bottom>=rect.top?"bottom":"top");
    }
    return next;
  });
  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:MouseEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("mousedown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("mousedown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[open]);
  const select=(emoji:string)=>{onChange(emoji);setOpen(false);};
  return (
    <div className="emoji-picker" ref={rootRef}>
      <div className="emoji-current">
        <input value={value} maxLength={96} onChange={e => onChange(e.target.value)} placeholder="Выберите эмодзи" aria-label="Эмодзи"/>
        <div className="emoji-anchor" ref={anchorRef}>
          <button type="button" className="btn secondary" onClick={toggle} aria-expanded={open}>Выбрать эмодзи</button>
          {open && <div className={`emoji-popover emoji-popover-${placement}`}><UnicodeEmojiPicker onSelect={select} serverEmojis={serverEmojis}/></div>}
        </div>
      </div>
    </div>
  );
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

export function TemplateLibrary({ title, note, description, action, extra, empty, children }: { title: string; note?: string | undefined; description: string; action?: ReactNode; extra?: ReactNode; empty: string; children?: ReactNode }) {
  return (
    <article className="card settings-card template-library">
      <CardHeader title={title} note={note} muted={description} action={action}/>
      {extra}
      {children ?? <p className="muted">{empty}</p>}
    </article>
  );
}

export function MediaField({ icon, label, file, previewUrl, saved, onPick, onClear, inputRef, clearLabel = "Удалить" }: { icon: ReactNode; label: string; file: File | null; previewUrl: string; saved: boolean; onPick: (file: File | null) => void; onClear: () => void; inputRef?: React.Ref<HTMLInputElement>; clearLabel?: string }) {
  return (
    <label className="media-upload">
      {icon}
      <span>{label}</span>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => onPick(e.target.files?.[0] ?? null)}/>
      <em>{file?.name ?? (saved ? "Сохранено — заменить" : "PNG, JPG, GIF")}</em>
      {previewUrl && <img className="media-preview" src={previewUrl} alt=""/>}
      {(saved || file) && <button type="button" className="btn danger small media-remove" onClick={onClear} aria-label={`${clearLabel}: ${label}`}>{clearLabel}</button>}
    </label>
  );
}

export function Select({ value, onChange, options, ariaLabel, placeholder, disabled }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; ariaLabel?: string | undefined; placeholder?: string | undefined; disabled?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [coords, setCoords] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);

  // Список рисуется порталом в <body> с position:fixed — как нативный селект:
  // ни overflow карточек, ни stacking-контексты его не обрезают и не перекрывают.
  const openList = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const willFlip = spaceBelow < Math.min(300, window.innerHeight / 2);
    setFlip(willFlip);
    setCoords({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
      ...(willFlip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onScrollOrResize = (event: Event) => {
      // Скролл внутри самого списка (ползунок, колесо) — не причина закрытия.
      if (listRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);
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
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
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
        // Тогл на mousedown с stopPropagation: <label> ре-диспатчит только
        // click, поэтому его синтетический повторный клик не закроет список.
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); open ? setOpen(false) : openList(); }}
        onKeyDown={e => {
          if ((e.key === "Enter" || e.key === " ") && !open) { e.preventDefault(); openList(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
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
          style={{ left: coords.left, width: coords.width, ...(flip ? { bottom: coords.bottom } : { top: coords.top }) }}
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
                  onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
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

export function ModalShell({ labelledBy, onClose, children }: { labelledBy: string; onClose?: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current?.(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, []);
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy}><div ref={dialogRef} className="modal">{children}</div></div>;
}

type ConfirmItem = { message: string; confirmLabel: string; resolve: (ok: boolean) => void };
let queue: ConfirmItem[] = [];
const subscribers = new Set<(items: ConfirmItem[]) => void>();
const emit = () => { for (const subscriber of subscribers) subscriber(queue); };

export function confirmAction(message: string, confirmLabel = "Подтвердить"): Promise<boolean> {
  return new Promise(resolve => {
    const item: ConfirmItem = { message, confirmLabel, resolve };
    queue = [...queue, item];
    emit();
  });
}

export function ConfirmHost() {
  const [items, setItems] = useState<ConfirmItem[]>([]);
  useEffect(() => {
    const subscriber = (next: ConfirmItem[]) => setItems(next);
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
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
      <button type="button" className="btn" onClick={() => close(true)}>{current.confirmLabel}</button>
      <button type="button" data-autofocus className="btn secondary" onClick={() => close(false)}>Отмена</button>
    </div>
  </ModalShell>;
}
