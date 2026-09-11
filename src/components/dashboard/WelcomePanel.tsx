"use client";

import { parseImageConfig, type WelcomeImageConfig } from "../../../src/lib/welcome.ts";
import { WelcomePreview } from "./WelcomePreview.tsx";
import { CardHeader, channelOptions, NumberField, SaveButton, Select, useAsyncAction } from "./ui.tsx";
import type { Channel, Welcome } from "./types.ts";

type MemberEventPatch = { enabled?: number; channel?: string | null; message?: string; imageEnabled?: number; config?: WelcomeImageConfig };
const welcomeVariables: [string, string][] = [["{user}", "упоминание"], ["{username}", "имя пользователя"], ["{displayName}", "имя на сервере"], ["{server}", "сервер"], ["{count}", "участников"], ["{memberCount}", "участников"], ["{userId}", "ID пользователя"], ["{userAvatar}", "аватар"], ["{serverIcon}", "иконка сервера"]];

export function WelcomeSettings({ channels, value, onChange, onSave, onUpload, bgTimestamp }: { channels: Channel[]; value: Welcome; onChange: (value: Welcome) => void; onSave: () => unknown; onUpload:(file:File)=>void; bgTimestamp: number }) {
  const { busy: saving, run } = useAsyncAction();
  return <div className="welcome-layout"><div className="event-settings"><MemberEvent title="Приветствие новых участников" event="welcome" channels={channels} value={value} onChange={onChange} onUpload={onUpload} bgTimestamp={bgTimestamp}/><MemberEvent title="Прощание с участником" event="goodbye" channels={channels} value={value} onChange={onChange} onUpload={onUpload} bgTimestamp={bgTimestamp}/></div><aside className="card variables-card floating-preview"><h2>Переменные</h2><div className="variables-list">{welcomeVariables.map(([token,help])=><span key={token}><code>{token}</code> {help}</span>)}</div><SaveButton saving={saving} onClick={() => run(onSave)}/></aside></div>;
}

function MemberEvent({title,event,channels,value,onChange,onUpload,bgTimestamp}:{title:string;event:"welcome"|"goodbye";channels:Channel[];value:Welcome;onChange:(value:Welcome)=>void;onUpload:(file:File)=>void;bgTimestamp:number}) {
  const goodbye=event==="goodbye", enabled=goodbye?value.goodbye_enabled:value.enabled, channel=goodbye?value.goodbye_channel_id:value.channel_id, message=goodbye?value.goodbye_message:value.message, imageEnabled=value.image_enabled, rawBackground=value.background_path, background=rawBackground?`${rawBackground}?v=${bgTimestamp}`:null, config=parseImageConfig(value.image_config_json);
  const set=(patch:MemberEventPatch)=>onChange(goodbye?{...value,goodbye_enabled:patch.enabled??enabled,goodbye_channel_id:patch.channel===undefined?channel:patch.channel,goodbye_message:patch.message??message}:{...value,enabled:patch.enabled??enabled,channel_id:patch.channel===undefined?channel:patch.channel,message:patch.message??message,image_enabled:patch.imageEnabled??imageEnabled,image_config_json:patch.config?JSON.stringify(patch.config):value.image_config_json});
  return <section className="card"><CardHeader title={title} muted={goodbye?"Канал и текст прощального сообщения.":"Отдельные канал, текст, фон и персональная картинка."} action={<label className="switch"><input type="checkbox" aria-label={goodbye?"Включить прощание":"Включить приветствие"} checked={Boolean(enabled)} onChange={e=>set({enabled:+e.target.checked})}/><span/></label>}/><div className="event-grid"><div className="settings-card"><label>Канал<Select value={channel??""} onChange={v=>set({channel:v||null})} ariaLabel="Канал события" options={channelOptions(channels, "Выберите канал")}/></label><label>Текст сообщения<textarea rows={4} maxLength={2000} value={message} onChange={e=>set({message:e.target.value})}/></label>{!goodbye&&<><label className="check-row"><input type="checkbox" checked={Boolean(imageEnabled)} onChange={e=>set({imageEnabled:+e.target.checked})}/> Отправлять персональную картинку</label>{Boolean(imageEnabled)&&<><div><span className="field-label">Фон картинки</span><label className="file-pick"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>e.target.files?.[0]&&onUpload(e.target.files[0])}/><span className="btn secondary small">Выбрать файл</span></label></div><ImageEditor value={config} onChange={config=>set({config})}/></>}</>}</div>{!goodbye&&<WelcomePreview message={message} config={config} background={background} enabled={Boolean(imageEnabled)} onChange={config=>set({config})}/>}</div></section>;
}

function ColorField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className="color-field"><span>{label}</span><span className="color-swatch" style={{background:value}} title={value}><input type="color" value={value} onChange={e=>onChange(e.target.value)} aria-label={label}/></span><code>{value}</code></label>; }

function EditorNumber({ label, field, value, min, max, onChange }: { label: string; field: keyof WelcomeImageConfig; value: WelcomeImageConfig; min: number; max: number; onChange: (value: WelcomeImageConfig) => void }) {
  return <NumberField label={label} min={min} max={max} value={value[field] as number} onChange={next => onChange({ ...value, [field]: next })}/>;
}
function EditorGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="editor-group"><span className="field-label">{title}</span>{children}</div>;
}
function ImageEditor({value,onChange}:{value:WelcomeImageConfig;onChange:(value:WelcomeImageConfig)=>void}) {
  const avatarRatio = value.avatarWidth / value.avatarHeight;
  const low = Math.max(48, Math.round(48 * avatarRatio)), high = Math.min(420, Math.round(420 * avatarRatio));
  const setAvatarSize = (next: WelcomeImageConfig) => {
    const width = Math.max(low, Math.min(high, next.avatarWidth));
    onChange({ ...next, avatarWidth: width, avatarHeight: Math.round(width / avatarRatio) });
  };
  return <div className="image-editor">
    <h3>Редактор картинки</h3>
    <EditorGroup title="Текст на картинке">
      <label>Ник<input value={value.title} maxLength={120} onChange={e=>onChange({...value,title:e.target.value})}/></label>
      <label>Нижний текст<input value={value.subtitle} maxLength={180} onChange={e=>onChange({...value,subtitle:e.target.value})}/></label>
      <div className="image-editor-colors"><ColorField label="Цвет ника" value={value.titleColor} onChange={titleColor=>onChange({...value,titleColor})}/><ColorField label="Цвет нижнего текста" value={value.subtitleColor} onChange={subtitleColor=>onChange({...value,subtitleColor})}/></div>
    </EditorGroup>
    <EditorGroup title="Положение и размер аватара">
      <div className="coordinate-grid">
        {/* Пропорции аватара сохраняются: высота считается из ширины. */}
        <EditorNumber label="Размер" field="avatarWidth" value={value} min={low} max={high} onChange={setAvatarSize}/>
        <EditorNumber label="Слева (px)" field="avatarX" value={value} min={0} max={900} onChange={onChange}/>
        <EditorNumber label="Сверху (px)" field="avatarY" value={value} min={0} max={480} onChange={onChange}/>
      </div>
    </EditorGroup>
    <EditorGroup title="Положение и размер ника">
      <div className="coordinate-grid">
        <EditorNumber label="Слева (px)" field="titleX" value={value} min={0} max={900} onChange={onChange}/>
        <EditorNumber label="Сверху (px)" field="titleY" value={value} min={0} max={480} onChange={onChange}/>
        <EditorNumber label="Размер шрифта" field="titleSize" value={value} min={12} max={96} onChange={onChange}/>
      </div>
    </EditorGroup>
    <EditorGroup title="Положение и размер нижнего текста">
      <div className="coordinate-grid">
        <EditorNumber label="Слева (px)" field="subtitleX" value={value} min={0} max={900} onChange={onChange}/>
        <EditorNumber label="Сверху (px)" field="subtitleY" value={value} min={0} max={480} onChange={onChange}/>
        <EditorNumber label="Размер шрифта" field="subtitleSize" value={value} min={10} max={72} onChange={onChange}/>
      </div>
    </EditorGroup>
  </div>;
}
