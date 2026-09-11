"use client";

import { useEffect, useState } from "react";
import { appealStatusMeta, punishmentLabels } from "../../../src/lib/labels.ts";
import type { AppealsListGet, AppealView } from "../../../src/lib/appeals.ts";
import { formatTime, CardHeader, Select, useAsyncAction } from "./ui.tsx";
import { apiGet, apiSend } from "./api.ts";
import type { PanelFail, PanelNotify } from "./types.ts";

const APPEAL_TONE: Record<string, string> = { pending: "pill-info", reviewing: "pill-accent", approved: "pill-ok", rejected: "pill-err", closed: "", declined: "pill-dim" };

export function AppealsPanel({guildId,onDone,onError}:{guildId:string;onDone:PanelNotify;onError:PanelFail}) {
  const [appeals,setAppeals]=useState<AppealView[]|null>(null),[filters,setFilters]=useState({status:"all",userId:"",moderatorId:"",from:"",to:""}),[offset,setOffset]=useState(0),[expanded,setExpanded]=useState<number|null>(null),[comment,setComment]=useState("");
  const [refresh, setRefresh] = useState(0);
  // Дебаунс текстовых фильтров: каждый кейстрок не должен DDoSить собственный API.
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);
  const { busy, run } = useAsyncAction();
  const query=(nextOffset:number, f = debouncedFilters)=>{const params=new URLSearchParams({status:f.status,limit:"100",offset:String(nextOffset)});if(f.userId.trim())params.set("userId",f.userId.trim());if(f.moderatorId.trim())params.set("moderatorId",f.moderatorId.trim());if(f.from)params.set("from",String(new Date(`${f.from}T00:00:00`).getTime()));if(f.to)params.set("to",String(new Date(`${f.to}T23:59:59`).getTime()));return params;};
  const loadPage=(nextOffset:number)=>apiGet<AppealsListGet>(`/api/guilds/${guildId}/appeals?${query(nextOffset)}`,{appeals:[]});
  useEffect(()=>{if(!guildId)return;let active=true;setAppeals(null);setOffset(0);setExpanded(null);void loadPage(0).then(data=>{if(!active)return;const rows=data.appeals;setAppeals(rows);setOffset(rows.length);});return()=>{active=false;};},[guildId,debouncedFilters,refresh]);
  const more=()=>{void loadPage(offset).then(data=>{const rows=data.appeals;if(!rows.length)return;setAppeals(value=>[...(value??[]),...rows]);setOffset(value=>value+rows.length);});};
  const review=async(row:AppealView,action:string)=>{if(busy)return;
  await run(async()=>{const sent=await apiSend<{appeal?:{status:string};notified?:boolean;reversal?:{failed:boolean;label:string}}>(`/api/guilds/${guildId}/appeals/${row.id}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,comment:comment.trim()||undefined})},"Не удалось изменить статус апелляции.");if(!sent.ok)return onError(sent.error);const data=sent.data;const label=appealStatusMeta[data.appeal?.status ?? ""]?.label??action;const dmNote=data.notified===false?" · личное сообщение пользователю не доставлено":"";const revNote=data.reversal?` · ${data.reversal.failed?"Снять не удалось":"Снят"}: ${data.reversal.label}.`:"";const failed = Boolean(data.reversal?.failed);
      onDone(data.reversal
        ? `Апелляция #${row.number}: «${label}».${revNote}${dmNote}`
        : `Апелляция #${row.number} переведена в «${label}».${dmNote}`, failed ? "warn" : undefined);
      setComment("");
      setExpanded(null);
      setRefresh(value => value + 1);
    });
  }

  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Апелляции на наказания" muted="Пользователям приходит личное сообщение с предложением подать апелляцию при выдаче наказания. Возьмите апелляцию в работу, одобрите, отклоните или закройте — при изменении статуса пользователю уходит личное сообщение с комментарием."/>
      </article>
      <article className="card settings-card">
        <div className="appeals-filters">
          <label>Статус
            <Select value={filters.status} onChange={status=>setFilters({...filters,status})} ariaLabel="Статус апелляции" options={[{value:"all",label:"Все"},...Object.entries(appealStatusMeta).map(([key,meta])=>({value:key,label:meta.label}))]}/>
          </label>
          <label>Пользователь (ID)
            <input value={filters.userId} placeholder="ID в Discord" onChange={e=>setFilters({...filters,userId:e.target.value})}/>
          </label>
          <label>Рассмотрел (ID)
            <input value={filters.moderatorId} placeholder="ID модератора" onChange={e=>setFilters({...filters,moderatorId:e.target.value})}/>
          </label>
          <label>Создана с
            <input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/>
          </label>
          <label>Создана по
            <input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/>
          </label>
        </div>
      </article>
      <article className="card appeal-list">
        {appeals===null ? (
          <p className="muted" role="status">Загружаем апелляции…</p>
        ) : appeals.length ? appeals.map(row=>{
          const meta=appealStatusMeta[row.status]??{label:row.status},activeAppeal=row.status==="pending"||row.status==="reviewing";
          return (
            <div className="appeal-item" key={row.id}>
              <button type="button" className="appeal-toggle" onClick={()=>setExpanded(expanded===row.id?null:row.id)} aria-expanded={expanded===row.id}>
                <span className="appeal-head">
                  <strong>#{row.number}</strong>
                  <span className={`pill ${APPEAL_TONE[row.status] ?? ""}`}>{meta.label}</span>
                </span>
                <span className="appeal-user">{row.user_id}</span>
                <span className="appeal-punishment">{punishmentLabels[row.type]??row.type} · {(row.punishment_reason??row.reason).slice(0,60)}</span>
                <time dateTime={new Date(row.created_at).toISOString()}>{formatTime(row.created_at)}</time>
                <span className="appeal-expand">{expanded===row.id?"▲":"▼"}</span>
              </button>
              {expanded===row.id&&<div className="appeal-detail">
                <div className="appeal-grid">
                  <div>
                    <span className="field-label">Текст пользователя</span>
                    <p>{row.reason}</p>
                  </div>
                  <div>
                    <span className="field-label">Наказание</span>
                    <p>{punishmentLabels[row.type]??row.type} — {row.punishment_reason??"причина не указана"} · <time dateTime={new Date(row.punishment_created_at).toISOString()}>{formatTime(row.punishment_created_at)}</time></p>
                  </div>
                  {row.reviewed_by&&<div>
                    <span className="field-label">Рассмотрел</span>
                    <p>{row.reviewed_by}{row.reviewed_at?` · ${formatTime(row.reviewed_at)}`:""}</p>
                  </div>}
                  {row.moderator_comment&&<div>
                    <span className="field-label">Комментарий модератора</span>
                    <p>{row.moderator_comment}</p>
                  </div>}
                </div>
                {activeAppeal?<div className="appeal-actions">
                  <label className="appeal-comment">Комментарий модератора
                    <textarea rows={3} maxLength={500} value={comment} placeholder="Будет отправлен пользователю в личные сообщения" onChange={e=>setComment(e.target.value)}/>
                  </label>
                  <div className="appeal-buttons">
                    {row.status==="pending"&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>void review(row,"reviewing")}>Взять в работу</button>}
                    <button type="button" className="btn" disabled={busy} onClick={()=>void review(row,"approved")}>Одобрить</button>
                    <button type="button" className="btn secondary" disabled={busy} onClick={()=>void review(row,"rejected")}>Отклонить</button>
                    <button type="button" className="btn secondary" disabled={busy} onClick={()=>void review(row,"closed")}>Закрыть</button>
                  </div>
                </div>:<p className="muted">Апелляция завершена — её статус больше нельзя изменить.</p>}
              </div>}
            </div>
          );
        }) : (
          <p className="muted">Апелляций не найдено. Попробуйте изменить фильтры.</p>
        )}
        {appeals&&appeals.length>=100&&<button type="button" className="btn secondary" onClick={more}>Показать ещё</button>}
      </article>
    </section>
  );
}
