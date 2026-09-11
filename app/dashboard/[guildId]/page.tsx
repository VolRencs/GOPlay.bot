"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bot, CalendarDays, Gavel, History, Image, Medal, Mic2, Music, ScrollText, Settings, ShieldCheck, Sparkles, Tags, X } from "lucide-react";
import { buildWelcomePutBody, welcomeDefaults, type WelcomeGet, type WelcomePutBody } from "../../../src/lib/welcome.ts";
import { automodRules, buildLoggingPutBody, type LoggingGet, type LoggingPutBody } from "../../../src/lib/labels.ts";
import { buildRulePutBody, type AutomodGet, type AutomodRulePutBody, type AutomodSecurityPutBody } from "../../../src/lib/automod.ts";
import { buildTempPutBody, type TempchannelsGet, type TempPutBody } from "../../../src/lib/tempchannels.ts";
import { buildLevelsPutBody, levelDefaults, type LevelsGet, type LevelsPutBody } from "../../../src/lib/levels.ts";
import { parseActions, safeJson } from "../../../src/lib/json.ts";
import { SERVER_FALLBACK_NAME } from "../../../src/lib/constants.ts";
import type { MusicSettings } from "../../../src/lib/music-settings.ts";
import type { Channel, LoggingState, Role, Rule, ServerEmoji, ServerIdentity, ServerStats, TempChannelsState, TempPresetApi, Welcome } from "../../../src/components/dashboard/types.ts";
import { buildMusicPutBody, defaultTempChannels, tempPresetFromApi, type LangGet, type LangPutBody, type MusicPutBody, type ResourcesGet } from "../../../src/components/dashboard/types.ts";
import { ConfirmHost, ModalShell, stableStringify } from "../../../src/components/dashboard/ui.tsx";
import { apiSend } from "../../../src/components/dashboard/api.ts";
import { ServerStatistics } from "../../../src/components/dashboard/StatsPanel.tsx";
import { TemporaryChannelsSettings } from "../../../src/components/dashboard/TempChannelsPanel.tsx";
import { LoggingSettings } from "../../../src/components/dashboard/LoggingPanel.tsx";
import { DashboardAuditLog, ServerDataCleanup } from "../../../src/components/dashboard/AuditPanel.tsx";
import { BotLanguageCard } from "../../../src/components/dashboard/BotLanguageCard.tsx";
import { MusicSettingsCard } from "../../../src/components/dashboard/MusicSettingsCard.tsx";
import { WelcomeSettings } from "../../../src/components/dashboard/WelcomePanel.tsx";
import { AutoModSettings, defaultRule } from "../../../src/components/dashboard/AutomodPanel.tsx";
import { RoleSettings } from "../../../src/components/dashboard/RolesPanel.tsx";
import { EmbedsPanel } from "../../../src/components/dashboard/EmbedsPanel.tsx";
import { AppealsPanel } from "../../../src/components/dashboard/AppealsPanel.tsx";
import { EventsPanel } from "../../../src/components/dashboard/EventsPanel.tsx";
import { LevelsPanel } from "../../../src/components/dashboard/LevelsPanel.tsx";

type TabKey = "welcome" | "automod" | "roles" | "levels" | "embeds" | "music" | "logging" | "stats" | "tempchannels" | "appeals" | "events" | "audit" | "settings";
const TAB_KEYS: readonly TabKey[] = ["stats", "welcome", "automod", "roles", "levels", "embeds", "music", "events", "logging", "tempchannels", "appeals", "audit", "settings"];
const TAB_LABELS: Record<TabKey, { nav: string; title: string }> = {
  stats: { nav: "Статистика", title: "Статистика сервера" }, welcome: { nav: "Приветствие", title: "Приветствие" },
  automod: { nav: "Автомодерация", title: "Автомодерация" }, roles: { nav: "Роли", title: "Самовыдача ролей" },
  levels: { nav: "Уровни", title: "Уровни и опыт" },
  embeds: { nav: "Embeds", title: "Конструктор embeds" }, music: { nav: "Музыка", title: "Музыка" }, events: { nav: "События", title: "События" },
  logging: { nav: "Логи", title: "Логирование" }, tempchannels: { nav: "Временные каналы", title: "Временные каналы" },
  appeals: { nav: "Апелляции", title: "Апелляции" }, audit: { nav: "Журнал изменений", title: "Журнал изменений" },
  settings: { nav: "Настройки", title: "Настройки" },
};

type Toast = { id: number; text: string; tone: "ok" | "warn" | "error" };
let toastSeq = 0;
const dirty = (a: unknown, b: unknown) => a !== null && stableStringify(a) !== stableStringify(b);

export default function GuildSettings({ params }: { params: Promise<{ guildId: string }> }) {
  const [guildId, setGuildId] = useState("");
  const [tab, setTab] = useState<TabKey>("stats");
  const [serverLang, setServerLang] = useState<"ru" | "en">("ru");
  const [savedServerLang, setSavedServerLang] = useState<"ru" | "en">("ru");
  const [music, setMusic] = useState<MusicSettings>({ command_channel_id: null, voice_channel_ids: [], allowed_role_ids: [], leave_after_seconds: 300 });
  const [savedMusic, setSavedMusic] = useState<MusicSettings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [stats, setStats] = useState<ServerStats>({ members: null, online: null });
  const [server, setServer] = useState<ServerIdentity>({ name: SERVER_FALLBACK_NAME, icon: null });
  const [welcome, setWelcome] = useState<Welcome>({ ...welcomeDefaults });
  const [bgTimestamp, setBgTimestamp] = useState(0);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [ignoredRoleIds,setIgnoredRoleIds]=useState<string[]>([]);
  const [protectedChannelId,setProtectedChannelId]=useState<string|null>(null);
  const [savedWelcome, setSavedWelcome] = useState<Welcome | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, Rule> | null>(null);
  const [savedSecurity, setSavedSecurity] = useState<{ roles: string[]; channel: string | null } | null>(null);
  const [logging, setLogging] = useState<LoggingState>({ channelId: "", categories: {} });
  const [savedLogging, setSavedLogging] = useState<LoggingState | null>(null);
  const [temp, setTemp] = useState<TempChannelsState>(defaultTempChannels);
  const [savedTemp, setSavedTemp] = useState<TempChannelsState | null>(null);
  const [levels, setLevels] = useState<LevelsGet>({ settings: { ...levelDefaults, ignored_channel_ids: [], ignored_role_ids: [] }, rewards: [] });
  const [savedLevels, setSavedLevels] = useState<LevelsGet | null>(null);
  const [pendingNav, setPendingNav] = useState<{ tab: string } | { href: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [loading, setLoading] = useState(true);

  const pushToast = (text: string, tone: Toast["tone"]) => {
    if (!text) return;
    const id = ++toastSeq;
    setToasts(list => [...list.slice(-3), { id, text, tone }]);
    if (tone !== "error") {
      const timer = setTimeout(() => {
        toastTimers.current.delete(id);
        setToasts(list => list.filter(item => item.id !== id));
      }, tone === "warn" ? 8000 : 4500);
      toastTimers.current.set(id, timer);
    }
  };
  const dismissToast = (id: number) => {
    setToasts(list => list.filter(item => item.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
  };
  useEffect(() => () => { for (const timer of toastTimers.current.values()) clearTimeout(timer); }, []);
  const notify = (message: string, tone?: "ok" | "warn") => pushToast(message, tone ?? "ok");
  const fail = (message: string) => pushToast(message, "error");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab") as TabKey | null;
    if (value && TAB_KEYS.includes(value)) setTab(value);
  }, []);
  function switchTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  useEffect(() => {
    let active = true;
    void params.then(async ({ guildId: id }) => {
      setLoading(true);
      try {
      setGuildId(id);
      const loadFail = "Не удалось загрузить настройки. Проверьте вход в Discord и доступ бота к серверу.";
      const [resourcesRes, welcomeRes, rulesRes, loggingRes, tempRes, langRes, musicRes, levelsRes] = await Promise.all([
        apiSend<ResourcesGet>(`/api/guilds/${id}/resources`, {}, loadFail),
        apiSend<WelcomeGet>(`/api/guilds/${id}/welcome`, {}, loadFail),
        apiSend<AutomodGet>(`/api/guilds/${id}/automod`, {}, loadFail),
        apiSend<LoggingGet>(`/api/guilds/${id}/logging`, {}, loadFail),
        apiSend<TempchannelsGet>(`/api/guilds/${id}/tempchannels`, {}, loadFail),
        apiSend<LangGet>(`/api/guilds/${id}/lang`, {}, loadFail),
        apiSend<MusicSettings>(`/api/guilds/${id}/music`, {}, loadFail),
        apiSend<LevelsGet>(`/api/guilds/${id}/levels`, {}, loadFail),
      ]);
      if (!resourcesRes.ok || !welcomeRes.ok || !rulesRes.ok || !loggingRes.ok || !tempRes.ok || !langRes.ok || !musicRes.ok || !levelsRes.ok) {
        const failed=[resourcesRes,welcomeRes,rulesRes,loggingRes,tempRes,langRes,musicRes,levelsRes].find(response=>!response.ok);
        if(active) fail(failed!.error);
        return;
      }
      const resourceData = resourcesRes.data, welcomeData = welcomeRes.data, automodData = rulesRes.data, loggingData = loggingRes.data, tempData = tempRes.data, langData = langRes.data, musicData = musicRes.data, levelsData = levelsRes.data;
      if(!active) return;
      setServerLang(langData.lang); setSavedServerLang(langData.lang);
      setMusic(musicData); setSavedMusic(musicData);
      setChannels(resourceData.channels);
      setVoiceChannels(resourceData.voiceChannels);
      setCategories(resourceData.categories);
      setRoles(resourceData.roles);
      setEmojis(resourceData.emojis);
      setStats(resourceData.stats);
      setServer(resourceData.server);
      const rulesData = Object.fromEntries(automodData.rules.map((rule) => [rule.kind, rule]));
      setWelcome(welcomeData); setSavedWelcome(welcomeData);
      setRules(rulesData); setIgnoredRoleIds(automodData.ignoredRoleIds);setProtectedChannelId(automodData.protectedChannelId);setSavedRules(rulesData);setSavedSecurity({roles:automodData.ignoredRoleIds,channel:automodData.protectedChannelId});
      const loggingCategories = safeJson<Record<string, boolean>>(loggingData.categories_json, {});
      const loggingValue={channelId:loggingData.channel_id??"",categories:loggingCategories};setLogging(loggingValue);setSavedLogging(loggingValue);
      const tempValue = { presets: tempData.presets.map(tempPresetFromApi) };
      setTemp(tempValue); setSavedTemp(tempValue);
      setLevels(levelsData); setSavedLevels(levelsData);
      } catch {
        if(active) fail("Не удалось соединиться с сервером.");
      } finally {
        if(active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [params]);

  const apiPut = async <TBody,>(url:string, body:TBody, onOk:()=>void, okMsg:string, report=true): Promise<boolean> => { const sent=await apiSend<{unchanged?:boolean}>(url,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)},"Не удалось сохранить изменения."); if(!sent.ok){fail(sent.error);return false;} onOk(); if(report) notify(sent.data.unchanged?"Изменений нет.":okMsg); return true; };
  async function saveWelcome(report=true): Promise<boolean> {
    if ((welcome.enabled && !welcome.channel_id) || (welcome.goodbye_enabled && !welcome.goodbye_channel_id)) return fail("Выберите канал для каждого включённого события."), false;
    return apiPut<WelcomePutBody>(`/api/guilds/${guildId}/welcome`, buildWelcomePutBody(welcome), ()=>setSavedWelcome(welcome), "Настройки приветствия и прощания сохранены.", report);
  }
  async function saveRule(kind:string, report=true): Promise<boolean> {
    const c=rules[kind]??defaultRule(kind);
    return apiPut<AutomodRulePutBody>(`/api/guilds/${guildId}/automod`, buildRulePutBody(kind, c, parseActions, (raw) => safeJson<Record<string, unknown>>(raw, {})), ()=>{setRules(v=>({...v,[kind]:c})); setSavedRules(v=>v?{...v,[kind]:c}:{[kind]:c});}, `Правило «${automodRules[kind]?.title ?? kind}» сохранено.`, report);
  }
  async function saveSecurity(report=true): Promise<boolean>{ return apiPut<AutomodSecurityPutBody>(`/api/guilds/${guildId}/automod`, { kind:"security", ignoredRoleIds, protectedChannelId }, ()=>setSavedSecurity({roles:ignoredRoleIds,channel:protectedChannelId}), "Общие исключения сохранены.", report); }
  async function saveLogging(report=true): Promise<boolean>{ return apiPut<LoggingPutBody>(`/api/guilds/${guildId}/logging`, buildLoggingPutBody(logging), ()=>setSavedLogging(logging), "Настройки логов сохранены.", report); }
  async function saveTemp(report=true): Promise<boolean>{
    const body: TempPutBody = buildTempPutBody(temp.presets);
    const sent=await apiSend<{presets?:TempPresetApi[];unchanged?:boolean}>(`/api/guilds/${guildId}/tempchannels`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)},"Не удалось сохранить временные каналы.");
    if(!sent.ok){fail(sent.error);return false;}
    const n=sent.data.presets?{presets:sent.data.presets.map(tempPresetFromApi)}:temp; setTemp(n); setSavedTemp(n); if(report) notify(sent.data.unchanged?"Изменений нет.":"Настройки временных каналов сохранены."); return true;
  }
  async function saveLang(report=true): Promise<boolean> {
    return apiPut<LangPutBody>(`/api/guilds/${guildId}/lang`, { lang: serverLang }, () => setSavedServerLang(serverLang), "Язык сообщений бота сохранён.", report);
  }
  async function saveMusic(report=true): Promise<boolean> {
    const payload: MusicPutBody = buildMusicPutBody(music);
    return apiPut<MusicPutBody>(`/api/guilds/${guildId}/music`, payload, () => { setMusic(payload); setSavedMusic(payload); }, "Настройки музыки сохранены.", report);
  }
  async function saveLevels(report=true): Promise<boolean> {
    const payload: LevelsPutBody = buildLevelsPutBody(levels.settings, levels.rewards);
    return apiPut<LevelsPutBody>(`/api/guilds/${guildId}/levels`, payload, () => { setLevels(payload); setSavedLevels(payload); }, "Настройки уровней сохранены.", report);
  }
  async function saveDirtyRules():Promise<boolean>{let ok=true;for(const k of Object.keys(rules)) if(dirty(savedRules?.[k]??null,rules[k])) ok=(await saveRule(k,false))&&ok;return ok;}
  async function saveAutoMod(): Promise<void>{let ok=true;if(securityDirty)ok=await saveSecurity(false);if(rulesDirty)ok=(await saveDirtyRules())&&ok;if(ok) notify("Настройки автомодерации сохранены.");}

  function updateRule(kind: string, change: Partial<Rule>) {
    const current = rules[kind] ?? defaultRule(kind);
    setRules((value) => ({ ...value, [kind]: { ...current, ...change } }));
  }

  async function uploadWelcomeBackground(file: File) { const body=new FormData(); body.set("background",file); const sent=await apiSend<{backgroundPath:string}>(`/api/guilds/${guildId}/welcome`,{method:"POST",body},"Не удалось загрузить фон."); if(sent.ok){const data=sent.data;setWelcome(v=>({...v,background_path:data.backgroundPath}));setSavedWelcome(p=>p?{...p,background_path:data.backgroundPath}:p);setBgTimestamp(Date.now());notify("Фон загружен.");}else fail(sent.error); }
  const welcomeDirty=useMemo(()=>dirty(savedWelcome,welcome),[savedWelcome,welcome]);
  const rulesDirty=useMemo(()=>dirty(savedRules,rules),[savedRules,rules]);
  const securityDirty=useMemo(()=>dirty(savedSecurity,{roles:ignoredRoleIds,channel:protectedChannelId}),[savedSecurity,ignoredRoleIds,protectedChannelId]);
  const loggingDirty=useMemo(()=>dirty(savedLogging,logging),[savedLogging,logging]);
  const tempDirty=useMemo(()=>dirty(savedTemp,temp),[savedTemp,temp]);
  const langDirty=useMemo(()=>dirty(savedServerLang,serverLang),[savedServerLang,serverLang]);
  const musicDirty=useMemo(()=>dirty(savedMusic,music),[savedMusic,music]);
  const levelsDirty=useMemo(()=>dirty(savedLevels,levels),[savedLevels,levels]);
  const isDirty=Boolean(guildId)&&(welcomeDirty||rulesDirty||securityDirty||loggingDirty||tempDirty||langDirty||musicDirty||levelsDirty);
  async function saveAllDirty():Promise<boolean>{let ok=true;if(welcomeDirty)ok=(await saveWelcome(false))&&ok;if(rulesDirty)ok=(await saveDirtyRules())&&ok;if(securityDirty)ok=(await saveSecurity(false))&&ok;if(loggingDirty)ok=(await saveLogging(false))&&ok;if(tempDirty)ok=(await saveTemp(false))&&ok;if(langDirty)ok=(await saveLang(false))&&ok;if(musicDirty)ok=(await saveMusic(false))&&ok;if(levelsDirty)ok=(await saveLevels(false))&&ok;if(ok&&isDirty) notify("Все изменения сохранены.");return ok;}
  function discardChanges(){setServerLang(savedServerLang);if(savedMusic)setMusic(savedMusic);if(savedWelcome)setWelcome(savedWelcome);if(savedRules)setRules(savedRules);if(savedSecurity){setIgnoredRoleIds(savedSecurity.roles);setProtectedChannelId(savedSecurity.channel);}if(savedLogging)setLogging(savedLogging);if(savedTemp)setTemp(savedTemp);if(savedLevels)setLevels(savedLevels);notify("Несохранённые изменения сброшены.");}
  function applyNav(nav:NonNullable<typeof pendingNav>){if("tab" in nav)switchTab(nav.tab as TabKey);else window.location.href=nav.href;setPendingNav(null);}
  async function saveAndGo(){if(!pendingNav)return;const ok=await saveAllDirty();if(ok)applyNav(pendingNav);else setPendingNav(null);}
  function discardAndGo(){if(!pendingNav)return;discardChanges();applyNav(pendingNav);}
  useEffect(()=>{if(!isDirty)return;const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};const blockLinks=(event:MouseEvent)=>{const target=event.target;if(!(target instanceof Element))return;const link=target.closest("a[href]");if(link&&!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey){event.preventDefault();setPendingNav({href:link.getAttribute("href")??"/"});}};window.addEventListener("beforeunload",beforeUnload);document.addEventListener("click",blockLinks,true);return()=>{window.removeEventListener("beforeunload",beforeUnload);document.removeEventListener("click",blockLinks,true);};},[isDirty]);
  return <main className="settings-shell">
    <aside className="sidebar"><a href="/dashboard" className="brand"><Bot size={22} /> GOPlay</a><p className="sidebar-label">НАСТРОЙКИ СЕРВЕРА</p><nav aria-label="Разделы настроек">{([
      ["stats", BarChart3], ["welcome", Sparkles], ["automod", ShieldCheck], ["roles", Tags], ["levels", Medal], ["embeds", Image], ["music", Music], ["events", CalendarDays], ["logging", ScrollText], ["tempchannels", Mic2], ["appeals", Gavel], ["audit", History], ["settings", Settings],
    ] as const).map(([key, Icon]) => <button type="button" key={key} className={tab === key ? "nav-item active" : "nav-item"} onClick={() => { if(key===tab)return; if(isDirty)setPendingNav({tab:key}); else switchTab(key); }}><Icon size={18} />{TAB_LABELS[key].nav}</button>)}</nav></aside>
    <section className="settings-content"><div className="settings-top"><div><a className="back-link" href="/dashboard">← Все серверы</a><div className="server-heading"><div className="server-heading-icon">{server.icon?<img src={`https://cdn.discordapp.com/icons/${guildId}/${server.icon}.png?size=128`} alt=""/>:<Bot size={24}/>}</div><div><p className="eyebrow">{server.name}</p><h1>{TAB_LABELS[tab].title}</h1></div></div></div></div>
      {loading && <p className="loading" role="status">Загружаем настройки сервера…</p>}
      <div className="toast-stack" role="region" aria-label="Уведомления">{toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}><span className="toast-dot" aria-hidden="true"/><span className="toast-text">{toast.text}</span><button type="button" className="toast-close" aria-label="Закрыть уведомление" onClick={() => dismissToast(toast.id)}><X size={14}/></button></div>)}</div>
      {tab === "welcome" && <WelcomeSettings channels={channels} value={welcome} onChange={setWelcome} onSave={() => saveWelcome()} onUpload={(file) => uploadWelcomeBackground(file)} bgTimestamp={bgTimestamp} />}
      {tab === "automod" && <AutoModSettings channels={channels} roles={roles} rules={rules} ignoredRoleIds={ignoredRoleIds} protectedChannelId={protectedChannelId} onGlobalChange={(roles,channel)=>{setIgnoredRoleIds(roles);setProtectedChannelId(channel);}} onSaveAll={() => saveAutoMod()} onChange={updateRule} />}
      {tab === "roles" && <RoleSettings guildId={guildId} roles={roles} emojis={emojis} channels={channels} onDone={notify} onError={fail} />}
      {tab === "levels" && <LevelsPanel channels={channels} roles={roles} value={levels.settings} rewards={levels.rewards} onChange={settings => setLevels(value => ({ ...value, settings }))} onRewardsChange={rewards => setLevels(value => ({ ...value, rewards }))} onSave={() => void saveLevels()} />}
      {tab === "embeds" && <EmbedsPanel guildId={guildId} channels={channels} onDone={notify} onError={fail} />}
      {tab === "music" && <MusicSettingsCard channels={channels} voiceChannels={voiceChannels} roles={roles} value={music} onChange={setMusic} onSave={() => void saveMusic()} />}
      {tab === "logging" && <LoggingSettings channels={channels} value={logging} onChange={setLogging} onSave={() => saveLogging()} />}
      {tab === "stats" && <ServerStatistics stats={stats} guildId={guildId} />}
      {tab === "tempchannels" && <TemporaryChannelsSettings voiceChannels={voiceChannels} categories={categories} value={temp} saved={savedTemp} onChange={setTemp} onSave={() => saveTemp()} />}
      {tab === "appeals" && <AppealsPanel guildId={guildId} onDone={notify} onError={fail} />}
      {tab === "events" && <EventsPanel guildId={guildId} channels={channels} roles={roles} emojis={emojis} onDone={notify} onError={fail} />}
      {tab === "audit" && <DashboardAuditLog guildId={guildId} />}
      {tab === "settings" && <section className="panel-stack">
        <BotLanguageCard value={serverLang} onChange={setServerLang} onSave={() => void saveLang()} />
        <ServerDataCleanup guildId={guildId} onDone={notify} onError={fail} />
      </section>}
    </section>
    {pendingNav && <ConfirmNavigationDialog onSave={()=>void saveAndGo()} onDiscard={discardAndGo} onCancel={()=>setPendingNav(null)} />}
    {isDirty && (
      <div className="unsaved-float" role="status">
        <span className="warn-dot" aria-hidden="true"/>
        <span>Есть несохранённые изменения</span>
        <button type="button" className="btn secondary" onClick={discardChanges}>Сбросить</button>
      </div>
    )}
    <ConfirmHost />
  </main>;
}

function ConfirmNavigationDialog({onSave,onDiscard,onCancel}:{onSave:()=>void;onDiscard:()=>void;onCancel:()=>void}) {
  return <ModalShell labelledBy="unsaved-modal-title" onClose={onCancel}>
    <h2 id="unsaved-modal-title">Несохранённые изменения</h2>
    <p className="muted">В текущем разделе есть несохранённые изменения. Сохраните их или сбросьте перед переходом, чтобы ничего не потерять.</p>
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onSave}>Сохранить изменения и перейти</button>
      <button type="button" className="btn secondary" onClick={onDiscard}>Сбросить изменения и перейти</button>
      <button type="button" data-autofocus className="btn secondary" onClick={onCancel}>Отмена</button>
    </div>
  </ModalShell>;
}
