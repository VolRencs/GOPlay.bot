"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { buildWelcomeSvg, renderWelcomeTemplate, WELCOME_DESIGN, welcomePreviewValues, type WelcomeImageConfig } from "../../../src/lib/welcome.ts";

const { width: DESIGN_W, height: DESIGN_H } = WELCOME_DESIGN;
const CENTER_X = DESIGN_W / 2;
const CENTER_Y = DESIGN_H / 2;
const SNAP_DIST = 26;

type DragTarget = "avatar" | "title" | "subtitle";
type ResizeDir = "ne" | "nw" | "se" | "sw";
type Gesture =
  | { kind: "move"; target: DragTarget; offX: number; offY: number }
  | { kind: "resize"; startW: number; startH: number; ratio: number; centerX: number; centerY: number; startDX: number; startDY: number };

function PreviewFrame({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <aside className="card preview-card floating-preview">
      <p className="eyebrow">ПРЕДПРОСМОТР · {hint}</p>
      {children}
    </aside>
  );
}

function DiscordMessageShell({ children }: { children: ReactNode }) {
  return (
    <div className="message-preview">
      <img className="preview-avatar" src="/bot-logo.png" alt="GOPlay"/>
      <div className="preview-message-body">
        <strong>GOPlay</strong>
        <span className="muted"> сегодня</span>
        {children}
      </div>
    </div>
  );
}

export function WelcomePreview({ message, config: committed, background, enabled, onChange }: { message: string; config: WelcomeImageConfig; background: string | null; enabled: boolean; onChange: (config: WelcomeImageConfig) => void }) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: DESIGN_W, height: DESIGN_H });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [snap, setSnap] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [live, setLive] = useState(committed);
  const pendingRef = useRef<Partial<WelcomeImageConfig>>({});
  const commitTimer = useRef<number | null>(null);
  const committedRef = useRef(committed);
  committedRef.current = committed;

  useEffect(() => { if (!gesture) setLive(committed); }, [committed, gesture]);
  useEffect(() => () => { if (commitTimer.current !== null) clearTimeout(commitTimer.current); }, []);

  // Канва равна реальному размеру фона: фото показывается целиком и сжатым
  // предпросмотре, без растяжения и обрезки.
  useEffect(() => {
    if (!background) { setSize({ width: DESIGN_W, height: DESIGN_H }); return; }
    const img = new Image();
    img.onload = () => setSize({ width: img.naturalWidth || DESIGN_W, height: img.naturalHeight || DESIGN_H });
    img.src = background;
  }, [background]);

  const render = (text: string) => renderWelcomeTemplate(text, welcomePreviewValues);

  const flushPending = () => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length) onChange({ ...committedRef.current, ...patch });
  };
  const queueCommit = (patch: Partial<WelcomeImageConfig>) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (commitTimer.current === null) commitTimer.current = window.setTimeout(() => { commitTimer.current = null; flushPending(); }, 120);
  };

  const startMove = (event: ReactPointerEvent<HTMLElement>, target: DragTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.closest(".welcome-canvas")?.getBoundingClientRect();
    const px = rect ? ((event.clientX - rect.left) / rect.width) * DESIGN_W : 0;
    const py = rect ? ((event.clientY - rect.top) / rect.height) * DESIGN_H : 0;
    const [anchorX, anchorY] = ({ avatar: [live.avatarX, live.avatarY], title: [live.titleX, live.titleY], subtitle: [live.subtitleX, live.subtitleY] } as const)[target];
    setGesture({ kind: "move", target, offX: px - anchorX, offY: py - anchorY });
    setSnap({ x: false, y: false });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.closest(".welcome-canvas")?.getBoundingClientRect();
    if (!rect) return;
    // Экранные координаты центра аватара и стартового расстояния до курсора:
    // дальше масштаб считается в пикселях, без пересчёта через оси канвы.
    const centerX = rect.left + (live.avatarX / DESIGN_W) * rect.width;
    const centerY = rect.top + (live.avatarY / DESIGN_H) * rect.height;
    setGesture({
      kind: "resize",
      startW: live.avatarWidth,
      startH: live.avatarHeight,
      ratio: live.avatarWidth / live.avatarHeight,
      centerX,
      centerY,
      startDX: Math.max(1, Math.abs(event.clientX - centerX)),
      startDY: Math.max(1, Math.abs(event.clientY - centerY)),
    });
    setSnap({ x: false, y: false });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture) return;

    // Ресайз — в экранных пикселях от центра: дизайн-координаты растягиваются
    // по осям канвы, и пересчёт через них «дёргал» аватар при захвате.
    if (gesture.kind === "resize") {
      const scale = Math.max(Math.abs(event.clientX - gesture.centerX) / gesture.startDX, Math.abs(event.clientY - gesture.centerY) / gesture.startDY);
      const low = Math.max(48, Math.round(48 * gesture.ratio));
      const high = Math.min(420, Math.round(420 * gesture.ratio));
      const width = Math.max(low, Math.min(high, Math.round(gesture.startW * scale)));
      const patch = { avatarWidth: width, avatarHeight: Math.round(width / gesture.ratio) };
      setLive(value => ({ ...value, ...patch }));
      queueCommit(patch);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * DESIGN_W);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * DESIGN_H);
    let nx = x - gesture.offX, ny = y - gesture.offY;
    const nextSnap = { x: false, y: false };
    if (event.shiftKey) {
      if (Math.abs(nx - CENTER_X) <= SNAP_DIST) { nx = CENTER_X; nextSnap.x = true; }
      if (Math.abs(ny - CENTER_Y) <= SNAP_DIST) { ny = CENTER_Y; nextSnap.y = true; }
    }
    setSnap(nextSnap);
    nx = Math.max(0, Math.min(DESIGN_W, nx));
    ny = Math.max(0, Math.min(DESIGN_H, ny));
    const patch = gesture.target === "avatar" ? { avatarX: nx, avatarY: ny } : gesture.target === "title" ? { titleX: nx, titleY: ny } : { subtitleX: nx, subtitleY: ny };
    setLive(value => ({ ...value, ...patch }));
    queueCommit(patch);
  };

  const endDrag = () => {
    if (!gesture) return;
    if (commitTimer.current !== null) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    flushPending();
    setGesture(null);
    setSnap({ x: false, y: false });
  };

  const svg = buildWelcomeSvg({
    backgroundHref: background,
    backgroundWidth: size.width,
    backgroundHeight: size.height,
    avatarHref: "/bot-logo.png",
    title: render(live.title),
    subtitle: render(live.subtitle),
    config: live,
  });

  const handleStyle = (dir: ResizeDir): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute", width: 9, height: 9, background: "#fff", border: "1.5px solid var(--violet)", borderRadius: 2 };
    const map: Record<ResizeDir, React.CSSProperties> = {
      ne: { top: -5, right: -5, cursor: "nesw-resize" },
      nw: { top: -5, left: -5, cursor: "nwse-resize" },
      se: { bottom: -5, right: -5, cursor: "nwse-resize" },
      sw: { bottom: -5, left: -5, cursor: "nesw-resize" },
    };
    return { ...base, ...map[dir] };
  };

  // Позиции — процент от канвы, размеры — один коэффициент по ширине (как в SVG):
  // так хит-зоны совпадают с отрисовкой на фоне любой пропорции.
  const scaleX = size.width / DESIGN_W, scaleY = size.height / DESIGN_H;

  return (
    <PreviewFrame hint={`${size.width} × ${size.height}`}>
      <DiscordMessageShell><p>{render(message.replace("{user}", "@Новый участник"))}</p></DiscordMessageShell>
      {enabled && (
        <div
          className={`welcome-canvas${gesture ? " is-dragging" : ""}`}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
          onPointerMove={move}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="canvas-svg" dangerouslySetInnerHTML={{ __html: svg }}/>
          {snap.x && <i className="drag-guide guide-v"/>}
          {snap.y && <i className="drag-guide guide-h"/>}
          {/* Прозрачные хит-зоны поверх точного SVG: двигают/меняют размер,
              визуальную правду рисует сам вектор. */}
          <div
            className={`preview-hit hit-avatar${gesture?.kind === "move" && gesture.target === "avatar" ? " grabbed" : ""}${gesture?.kind === "resize" ? " grabbed" : ""}`}
            onPointerDown={e => startMove(e, "avatar")}
            style={{
              left: `${(live.avatarX - live.avatarWidth / 2) / 9}%`,
              top: `${((live.avatarY * scaleY - (live.avatarHeight * scaleX) / 2) / size.height) * 100}%`,
              width: `${live.avatarWidth / 9}%`,
              height: `${((live.avatarHeight * scaleX) / size.height) * 100}%`,
            }}
          >
            {(["ne","nw","se","sw"] as ResizeDir[]).map(dir => (
              <span key={dir} className="r-handle" data-dir={dir} style={handleStyle(dir)} onPointerDown={e => startResize(e)} aria-label={`Изменить размер аватара (${dir})`}/>
            ))}
          </div>
          {([["title", live.titleX, live.titleY, live.titleSize], ["subtitle", live.subtitleX, live.subtitleY, live.subtitleSize]] as const).map(([target, tx, ty, fontSize]) => (
            <div
              key={target}
              className={`preview-hit hit-text${gesture?.kind === "move" && gesture.target === target ? " grabbed" : ""}`}
              onPointerDown={e => startMove(e, target)}
              style={{ left: `${tx / 9}%`, top: `${((ty * scaleY - fontSize * scaleX * 1.2) / size.height) * 100}%`, width: "56%", height: `${((fontSize * scaleX * 1.7) / size.height) * 100}%` }}
            />
          ))}
        </div>
      )}
    </PreviewFrame>
  );
}
