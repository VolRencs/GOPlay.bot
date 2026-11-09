"use client";

import { useEffect, useRef, useState } from "react";
import type { WelcomeImageConfig } from "#lib/welcome.ts";
import { welcomeDefaults, type WelcomeDto } from "#contracts/welcome.ts";
import { WelcomePreview } from "./WelcomePreview.tsx";
import { CardHeader, SectionError, SectionLoading, channelOptions, ColorRow, confirmAction, NumberField, SaveButton, Select } from "./ui.tsx";
import { apiMutate, apiUpload, type UploadProgress } from "./api.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";
import type { Channel } from "./types.ts";

type MemberEventPatch = { enabled?: boolean; channel?: string | null; message?: string; imageEnabled?: boolean; config?: WelcomeImageConfig };
const welcomeVariables: [string, string][] = [["{user}", "упоминание"], ["{username}", "имя пользователя"], ["{displayName}", "имя на сервере"], ["{server}", "сервер"], ["{count}", "участников"], ["{memberCount}", "участников"], ["{userId}", "ID пользователя"], ["{userAvatar}", "аватар"], ["{serverIcon}", "иконка сервера"]];
const ALLOWED_BACKGROUND_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;

export function WelcomeSettings() {
  const { guildId, resources, notify, fail } = useDashboard();
  const { value, setValue, patch, loading, loadError, reload, saving, saveNow } = useSettingsTab<WelcomeDto, WelcomeDto>({
    initial: { ...welcomeDefaults },
    fromGet: data => ({ ...welcomeDefaults, ...data }),
    toBody: value => value,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить настройки приветствия.",
    saveError: "Не удалось сохранить настройки приветствия.",
    savedMessage: "Настройки приветствия и прощания сохранены.",
    settingsKey: "welcome",
  });
  const [bgTimestamp, setBgTimestamp] = useState(0);
  const [uploadState, setUploadState] = useState<UploadProgress | null>(null);
  const [removing, setRemoving] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const localPreviewRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  }, []);
  if (loading) return <SectionLoading/>;
  if (loadError) return <SectionError message={loadError} onRetry={reload}/>;
  const channels = resources?.channels ?? [];
  const endpoint = `/api/guilds/${guildId}/welcome`;

  function clearLocalPreview() {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = null;
    }
    setLocalPreview(null);
  }

  async function upload(file: File) {
    if (!ALLOWED_BACKGROUND_TYPES.has(file.type)) {
      fail("Допустимы PNG, JPG или WEBP.");
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      fail("Файл больше 5 МБ.");
      return;
    }
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    const preview = URL.createObjectURL(file);
    localPreviewRef.current = preview;
    setLocalPreview(preview);
    setUploadState({ loaded: 0, total: file.size, percent: 0 });
    const body = new FormData();
    body.set("background", file);
    const sent = await apiUpload<{ backgroundPath: string; imageEnabled?: boolean }>(endpoint, body, "Не удалось загрузить фон.", setUploadState);
    setUploadState(null);
    if (sent.ok) {
      patch(current => ({ ...current, backgroundPath: sent.data.backgroundPath, imageEnabled: true }));
      setBgTimestamp(Date.now());
      clearLocalPreview();
      notify("Фон загружен и включён.");
    } else {
      clearLocalPreview();
      fail(sent.error);
    }
  }

  async function removeBackground() {
    if (uploadState || removing) return;
    if (!(await confirmAction("Удалить фон картинки приветствия?", "Удалить"))) return;
    setRemoving(true);
    const sent = await apiMutate(endpoint, { method: "DELETE" }, "Не удалось удалить фон.");
    setRemoving(false);
    if (!sent.ok) { fail(sent.error); return; }
    clearLocalPreview();
    patch(current => ({ ...current, backgroundPath: null }));
    setBgTimestamp(Date.now());
    notify("Фон удалён.");
  }

  return <div className="welcome-layout">
    <div className="event-settings">
      <MemberEvent title="Приветствие новых участников" event="welcome" channels={channels} value={value} onChange={setValue} onUpload={upload} onRemove={removeBackground} bgTimestamp={bgTimestamp} previewBackground={localPreview} uploadProgress={uploadState} removing={removing}/>
      <MemberEvent title="Прощание с участником" event="goodbye" channels={channels} value={value} onChange={setValue} onUpload={upload} onRemove={removeBackground} bgTimestamp={bgTimestamp} previewBackground={localPreview} uploadProgress={uploadState} removing={removing}/>
    </div>
    <aside className="card variables-card floating-preview"><h2>Переменные</h2><div className="variables-list">{welcomeVariables.map(([token, help]) => <span key={token}><code>{token}</code> {help}</span>)}</div><SaveButton saving={saving} onClick={saveNow}/></aside>
  </div>;
}

type MemberEventProps = {
  title: string;
  event: "welcome" | "goodbye";
  channels: Channel[];
  value: WelcomeDto;
  onChange: (value: WelcomeDto) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
  bgTimestamp: number;
  previewBackground: string | null;
  uploadProgress: UploadProgress | null;
  removing: boolean;
};

function MemberEvent({ title, event, channels, value, onChange, onUpload, onRemove, bgTimestamp, previewBackground, uploadProgress, removing }: MemberEventProps) {
  const goodbye = event === "goodbye";
  const enabled = goodbye ? value.goodbyeEnabled : value.enabled;
  const channel = goodbye ? value.goodbyeChannelId : value.channelId;
  const message = goodbye ? value.goodbyeMessage : value.message;
  const imageEnabled = value.imageEnabled;
  const rawBackground = value.backgroundPath;
  const background = previewBackground ?? (rawBackground ? `${rawBackground}?v=${bgTimestamp}` : null);
  const config = value.imageConfig;
  const uploading = uploadProgress !== null;
  const set = (patch: MemberEventPatch) => onChange(goodbye
    ? { ...value, goodbyeEnabled: patch.enabled ?? enabled, goodbyeChannelId: patch.channel === undefined ? channel : patch.channel, goodbyeMessage: patch.message ?? message }
    : { ...value, enabled: patch.enabled ?? enabled, channelId: patch.channel === undefined ? channel : patch.channel, message: patch.message ?? message, imageEnabled: patch.imageEnabled ?? imageEnabled, imageConfig: patch.config ?? value.imageConfig });
  return <section className="card">
    <CardHeader title={title} muted={goodbye ? "Канал и текст прощального сообщения." : "Отдельные канал, текст, фон и персональная картинка."} action={<label className="switch"><input type="checkbox" aria-label={goodbye ? "Включить прощание" : "Включить приветствие"} checked={Boolean(enabled)} onChange={e => set({ enabled: e.target.checked })}/><span/></label>}/>
    <div className="event-grid">
      <div className="settings-card">
        <label>Канал<Select value={channel ?? ""} onChange={v => set({ channel: v || null })} ariaLabel="Канал события" options={channelOptions(channels, "Выберите канал")}/></label>
        <label>Текст сообщения<textarea rows={4} maxLength={2000} value={message} onChange={e => set({ message: e.target.value })}/></label>
        {!goodbye && <>
          <label className="check-row"><input type="checkbox" checked={Boolean(imageEnabled)} onChange={e => set({ imageEnabled: e.target.checked })}/> Отправлять персональную картинку</label>
          {Boolean(imageEnabled) && <>
            <div>
              <span className="field-label">Фон картинки</span>
              <div className="file-actions">
                <label className={uploading ? "file-pick is-busy" : "file-pick"}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || removing} onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); e.target.value = ""; }}/>
                  <span className="btn secondary small">{uploading ? "Загрузка…" : "Выбрать файл"}</span>
                </label>
                {(rawBackground || previewBackground) && <button type="button" className="btn danger small" disabled={uploading || removing} onClick={onRemove}>{removing ? "Удаляем…" : "Удалить фон"}</button>}
              </div>
              {uploadProgress && <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress.percent}>
                <div className="upload-progress-bar"><span style={{ width: `${uploadProgress.percent}%` }}/></div>
                <small>Загрузка… {uploadProgress.percent}%{uploadProgress.total ? ` · ${formatBytes(uploadProgress.loaded)} из ${formatBytes(uploadProgress.total)}` : ""}</small>
              </div>}
            </div>
            <ImageEditor value={config} onChange={config => set({ config })}/>
          </>}
        </>}
      </div>
      {!goodbye && <WelcomePreview message={message} config={config} background={background} enabled={Boolean(imageEnabled)} onChange={config => set({ config })}/>}
    </div>
  </section>;
}

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
      <div className="image-editor-colors"><ColorRow label="Цвет ника" color={value.titleColor} onChange={titleColor=>onChange({...value,titleColor})} presets={false}/><ColorRow label="Цвет нижнего текста" color={value.subtitleColor} onChange={subtitleColor=>onChange({...value,subtitleColor})} presets={false}/></div>
    </EditorGroup>
    <EditorGroup title="Положение и размер аватара">
      <div className="coordinate-grid">
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
