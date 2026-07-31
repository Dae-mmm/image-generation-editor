import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import {
  Upload, Download, Plus, Trash2, FileSpreadsheet,
  RefreshCcw, Move, ZoomIn, Save, FolderOpen,
} from "lucide-react";
import * as XLSX from "xlsx";
import simboloPSC from "../imports/SimboloPSC.png";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImgTransform {
  src: string;
  x: number;   // slide-space pan offset
  y: number;
  scale: number;
}

interface Slide {
  id: string;
  descrizione: string;
  prezzoTesserati: string;
  prezzoListino: string;
  sconto: string;
  bg: ImgTransform | null;
  logo: ImgTransform | null;
}

type TextKey =
  | "descrizione"
  | "labelTesserati"
  | "prezzoTesserati"
  | "labelListino"
  | "prezzoListino"
  | "sconto";

interface TextStyle {
  size: number;
  x: number; // left (or right edge if align === "right")
  y: number; // top
  align: "left" | "right";
}

type TextLayout = Record<TextKey, TextStyle>;

interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ActiveEdit = "bg" | "logo" | "logoBox" | "tesseratiBox" | TextKey | null;

const TEXT_KEYS: TextKey[] = [
  "descrizione",
  "labelTesserati",
  "prezzoTesserati",
  "labelListino",
  "prezzoListino",
  "sconto",
];

const TEXT_LABELS: Record<TextKey, string> = {
  descrizione: "Descrizione",
  labelTesserati: "Label Tesserati",
  prezzoTesserati: "Prezzo Tesserati",
  labelListino: "Label Listino",
  prezzoListino: "Prezzo Listino",
  sconto: "Sconto",
};

/** Defaults calibrated at DEFAULT_H (685). x = left, or right edge when align=right. */
function defaultTextLayout(): TextLayout {
  return {
    descrizione:     { size: 22,  x: 38,  y: 464, align: "left" },
    labelTesserati:  { size: 25,  x: 32,  y: 532, align: "left" },
    prezzoTesserati: { size: 61,  x: 299, y: 569, align: "right" },
    labelListino:    { size: 20,  x: 319, y: 566, align: "left" },
    prezzoListino:   { size: 30,  x: 447, y: 611, align: "right" },
    sconto:          { size: 90,  x: 758, y: 532, align: "right" },
  };
}

function defaultLogoBox(): LayoutBox {
  return { x: 500, y: 18, w: 284, h: 165 };
}

function defaultTesseratiBox(): LayoutBox {
  return { x: 21, y: 518, w: 289, h: 140 };
}

function isTextKey(k: string | null): k is TextKey {
  return !!k && (TEXT_KEYS as string[]).includes(k);
}

// ─── Layout constants (800px frame) ───────────────────────────────────────────
//
//  ╔═══════════════════════════════════════════════════╗  ← CARD (800×H, BR=36)
//  ║  ♛ CROWN (white PNG, top-center)  [LOGO BOX    ] ║
//  ║  ┌─────────────────────────────────────────────┐  ║
//  ║  │   PHOTO (rounded, inset 22px lr, 41px top)  │  ║
//  ║  │                                             │  ║
//  ║  │   [description text on photo]               │  ║
//  ║  │   ┌──────────────┐                          │  ║
//  ║  │   │ Prezzo       │  Prezzo      -50%        │  ║
//  ║  │   │ Tesserati    │  di listino  (white)     │  ║
//  ║  │   │  5,99€ (big) │  14,90€                  │  ║
//  ║  └───┴──────────────┴──────────────────────────┘  ║
//  ╚═══════════════════════════════════════════════════╝
//
// The card IS the full 800×H area. No separate white inner panel.
// The white visible in the price area comes from the two white price boxes.
// The discount text floats on the photo in white.

const CARD_W = 800;
const GREEN   = "#4f8d53";
const BR      = 36;          // card border-radius
const DEFAULT_H = 685;

// Photo
const PHOTO_L     = 22;   // left/right inset from card edge
const PHOTO_T     = 41;   // top inset (crown zone height)
const PHOTO_B_MRG = 51;   // photo.bottom = H - PHOTO_B_MRG
const PHOTO_W     = CARD_W - PHOTO_L * 2;  // 756
const PHOTO_RADIUS = 22;

// Crown (SimboloPSC.png — white PNG on transparent; shows white on green bg)
const CROWN_W = 48;
const CROWN_H = 28;
const CROWN_Y = 7;

const LOGO_RADIUS = 22;

// Price boxes — PBOX1 (listino) still bottom-anchored; PBOX2 (tesserati) is layout-driven
const PBOX_L     = 33;
const PBOX_B_MRG = 30;    // boxes.bottom = H - PBOX_B_MRG
const PBOX1_W    = 421;
const PBOX1_H    = 93;
const PBOX_RADIUS = 22;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function photoRect(H: number) {
  return { l: PHOTO_L, t: PHOTO_T, w: PHOTO_W, b: H - PHOTO_B_MRG, h: H - PHOTO_B_MRG - PHOTO_T };
}

function pbox1Rect(H: number) {
  const b = H - PBOX_B_MRG;
  return { l: PBOX_L, t: b - PBOX1_H, w: PBOX1_W, h: PBOX1_H, b };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

function mkSlide(d?: Partial<Omit<Slide, "id">>): Slide {
  return { id: uid(), descrizione: "", prezzoTesserati: "", prezzoListino: "", sconto: "", bg: null, logo: null, ...d };
}

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function cleanPrice(raw: string): string {
  return String(raw ?? "").replace(/[€$]/g, "").replace(/\s+/g, "").trim();
}

/** "71,67%" → "-72%" */
function formatSconto(raw: string): string {
  const n = parseFloat(String(raw ?? "").replace(/%/g, "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return "";
  return `-${Math.round(n)}%`;
}

function colsFromLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
}

function slideFromPositionalCols(cols: string[]): Slide | null {
  if (cols.length < 8) return null;
  const descrizione = String(cols[2] ?? "").trim();
  if (!descrizione) return null;
  return mkSlide({
    descrizione,
    prezzoListino: cleanPrice(cols[5]),
    prezzoTesserati: cleanPrice(cols[6]),
    sconto: formatSconto(cols[7]),
  });
}

function parseProductText(text: string): Slide[] {
  const slides: Slide[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const slide = slideFromPositionalCols(colsFromLine(trimmed));
    if (slide) slides.push(slide);
  }
  return slides;
}

function parseXlsx(file: File): Promise<Slide[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target!.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        if (!rows.length) return resolve([]);

        const first = (rows[0] as any[]).map((h) => String(h ?? "").toLowerCase());
        const col = (...kws: string[]) => {
          for (const kw of kws) { const i = first.findIndex((h) => h.includes(kw)); if (i >= 0) return i; }
          return -1;
        };
        const dc = col("descriz", "nome", "prodotto", "name");
        const tc = col("tesserat", "soci", "member");
        const lc = col("listino", "cartellino", "originale", "list");
        const sc = col("sconto", "discount");
        const hasHeaders = dc >= 0 || tc >= 0 || lc >= 0 || sc >= 0;

        const slides: Slide[] = [];
        if (hasHeaders) {
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i] as any[];
            if (!r?.length) continue;
            const v = (ci: number) => ci >= 0 ? String(r[ci] ?? "").replace(/[€$%]/g, "").trim() : "";
            const scontoRaw = sc >= 0 ? String(r[sc] ?? "") : "";
            slides.push(mkSlide({
              descrizione: v(dc),
              prezzoTesserati: v(tc),
              prezzoListino: v(lc),
              sconto: sc >= 0 ? formatSconto(scontoRaw) : "",
            }));
          }
        } else {
          for (const row of rows) {
            const cols = (row as any[]).map((c) => String(c ?? "").trim());
            const slide = slideFromPositionalCols(cols);
            if (slide) slides.push(slide);
          }
        }
        resolve(slides);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y, r);
  ctx.closePath();
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** Fit entire image inside the box (no crop at scale=1). Extra space = letterbox. */
function drawContain(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  bx: number, by: number, bw: number, bh: number,
  tx: number, ty: number, scale: number,
) {
  const ia = img.naturalWidth / img.naturalHeight;
  const ba = bw / bh;
  let dw: number, dh: number;
  if (ia > ba) { dw = bw * scale; dh = dw / ia; }
  else          { dh = bh * scale; dw = dh * ia; }
  ctx.drawImage(img, bx + bw / 2 + tx - dw / 2, by + bh / 2 + ty - dh / 2, dw, dh);
}

// ─── Canvas export ────────────────────────────────────────────────────────────

function drawLayoutText(
  ctx: CanvasRenderingContext2D,
  style: TextStyle,
  text: string,
  opts: { color: string; weight: number; fontFam: string; shadow?: boolean; lineGap?: number },
) {
  if (!text) return;
  const ff = `"${opts.fontFam}", sans-serif`;
  ctx.fillStyle = opts.color;
  ctx.font = `${opts.weight} ${style.size}px ${ff}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = "top";
  if (opts.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 12;
  }
  const lines = text.split("\n");
  const gap = opts.lineGap ?? style.size * 1.3;
  lines.forEach((line, i) => {
    ctx.fillText(line, style.x, style.y + i * gap);
  });
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

async function exportSlide(
  slide: Slide, H: number, fontFam: string,
  textLayout: TextLayout, logoBox: LayoutBox, tesseratiBox: LayoutBox,
) {
  await document.fonts.ready;

  const W = CARD_W;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const ph = photoRect(H);
  const pb1 = pbox1Rect(H);
  const { x: LOGO_X, y: LOGO_Y, w: LOGO_W, h: LOGO_H } = logoBox;

  // 1. White canvas background (shows through card corners)
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  // 2. Green card (full canvas, rounded)
  ctx.fillStyle = GREEN;
  rrect(ctx, 0, 0, W, H, BR); ctx.fill();

  // 3. Photo (clipped)
  ctx.save();
  rrect(ctx, ph.l, ph.t, ph.w, ph.h, PHOTO_RADIUS); ctx.clip();

  if (slide.bg) {
    const img = await loadImg(slide.bg.src);
    drawContain(ctx, img, ph.l, ph.t, ph.w, ph.h, slide.bg.x, slide.bg.y, slide.bg.scale);
  } else {
    ctx.fillStyle = "#d0d0d0"; ctx.fillRect(ph.l, ph.t, ph.w, ph.h);
  }
  ctx.restore(); // end photo clip

  // 4. PBOX1 — wide/short (back), with shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 10;
  ctx.fillStyle = "white";
  rrect(ctx, pb1.l, pb1.t, pb1.w, pb1.h, PBOX_RADIUS); ctx.fill();
  ctx.restore();

  // 5. PBOX2 — narrow/tall (front), with heavier shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.40)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
  ctx.fillStyle = "white";
  rrect(ctx, tesseratiBox.x, tesseratiBox.y, tesseratiBox.w, tesseratiBox.h, PBOX_RADIUS); ctx.fill();
  ctx.restore();

  // Texts (layout-driven)
  if (slide.descrizione) {
    drawLayoutText(ctx, textLayout.descrizione, slide.descrizione, {
      color: "white", weight: 700, fontFam, shadow: true,
    });
  }
  drawLayoutText(ctx, textLayout.labelTesserati, "Prezzo Tesserati", {
    color: GREEN, weight: 600, fontFam,
  });
  if (slide.prezzoTesserati) {
    drawLayoutText(ctx, textLayout.prezzoTesserati, `${slide.prezzoTesserati}€`, {
      color: GREEN, weight: 700, fontFam,
    });
  }
  drawLayoutText(ctx, textLayout.labelListino, "Prezzo\ndi listino", {
    color: "#b7b7b7", weight: 400, fontFam,
  });
  if (slide.prezzoListino) {
    drawLayoutText(ctx, textLayout.prezzoListino, `${slide.prezzoListino}€`, {
      color: "#b7b7b7", weight: 400, fontFam,
    });
  }
  if (slide.sconto) {
    drawLayoutText(ctx, textLayout.sconto, slide.sconto, {
      color: "white", weight: 400, fontFam,
    });
  }

  // 11. Crown (white PNG drawn directly; transparent bg = green card shows through)
  try {
    const crownImg = await loadImg(simboloPSC);
    ctx.drawImage(crownImg, CARD_W / 2 - CROWN_W / 2, CROWN_Y, CROWN_W, CROWN_H);
  } catch (_) {}

  // 12. Logo box (white rounded rect)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  ctx.fillStyle = "white";
  rrect(ctx, LOGO_X, LOGO_Y, LOGO_W, LOGO_H, LOGO_RADIUS); ctx.fill();
  ctx.restore();

  // 13. Logo image (inside logo box)
  if (slide.logo) {
    ctx.save();
    rrect(ctx, LOGO_X, LOGO_Y, LOGO_W, LOGO_H, LOGO_RADIUS); ctx.clip();
    const li = await loadImg(slide.logo.src);
    // use contain (not cover) for logo
    const ia = li.naturalWidth / li.naturalHeight;
    const ba = LOGO_W / LOGO_H;
    let dw: number, dh: number;
    const pad = 20;
    if (ia > ba) { dw = LOGO_W - pad * 2; dh = dw / ia; }
    else          { dh = LOGO_H - pad * 2; dw = dh * ia; }
    const logoX2 = LOGO_X + (LOGO_W - dw) / 2 + slide.logo.x;
    const logoY2 = LOGO_Y + (LOGO_H - dh) / 2 + slide.logo.y;
    ctx.drawImage(li, logoX2, logoY2, dw * slide.logo.scale, dh * slide.logo.scale);
    ctx.restore();
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slide.descrizione || "slide"}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/jpeg", 0.95);
}

// ─── DraggableImage ──────────────────────────────────────────────────────────

interface DraggableImageProps {
  transform: ImgTransform | null;
  onUpdate: (t: ImgTransform) => void;
  onUpload: (f: File) => void;
  isEditing: boolean;
  label: string;
  objectFit?: "cover" | "contain";
  previewScale: number;
  /** Called once at the start of a drag/zoom gesture (for undo snapshots). */
  onGestureStart?: () => void;
  /** When true, image may paint outside the box (re-framing preview). */
  showOverflow?: boolean;
}

function DraggableImage({
  transform, onUpdate, onUpload, isEditing, label,
  objectFit = "cover", previewScale, onGestureStart, showOverflow = false,
}: DraggableImageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos  = useRef({ x: 0, y: 0 });
  const latest   = useRef(transform);
  latest.current = transform;
  const editingRef = useRef(isEditing);
  editingRef.current = isEditing;
  const gestureStarted = useRef(false);
  const wheelTimer = useRef<number | null>(null);
  const fid = `fu-${label.replace(/\W/g, "")}`;

  const beginGesture = () => {
    if (gestureStarted.current) return;
    gestureStarted.current = true;
    onGestureStart?.();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !latest.current) return;
      const dx = (e.clientX - lastPos.current.x) / previewScale;
      const dy = (e.clientY - lastPos.current.y) / previewScale;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onUpdate({ ...latest.current, x: latest.current.x + dx, y: latest.current.y + dy });
    };
    const onUp = () => {
      dragging.current = false;
      gestureStarted.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onUpdate, previewScale]);

  // Non-passive wheel so zoom works reliably over the preview
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!editingRef.current || !latest.current) return;
      e.preventDefault();
      e.stopPropagation();
      beginGesture();
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => { gestureStarted.current = false; }, 280);
      const f = e.deltaY < 0 ? 1.025 : 1 / 1.025;
      const next = Math.max(0.15, Math.min(12, latest.current.scale * f));
      onUpdate({ ...latest.current, scale: Math.round(next * 1000) / 1000 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, [onUpdate, onGestureStart]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{
        cursor: isEditing ? "grab" : transform ? "pointer" : "default",
        userSelect: "none",
        overflow: showOverflow ? "visible" : "hidden",
      }}
      onMouseDown={(e) => {
        if (!transform || !isEditing) return;
        beginGesture();
        dragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault(); e.stopPropagation();
      }}
      onClick={(e) => { if (!transform) { e.stopPropagation(); document.getElementById(fid)?.click(); } }}
    >
      {transform ? (
        <img
          src={transform.src} alt="" draggable={false}
          style={{
            position: "absolute", top: "50%", left: "50%",
            width: "100%", height: "100%", objectFit,
            transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale})`,
            transformOrigin: "center center",
            userSelect: "none", pointerEvents: "none",
            opacity: showOverflow ? 0.45 : 1,
          }}
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 cursor-pointer"
          style={{ background: "rgba(0,0,0,0.07)", color: "#ccc" }}
        >
          <Upload size={20} strokeWidth={1.5} />
          <span style={{ fontSize: 10, fontFamily: "system-ui" }}>{label}</span>
        </div>
      )}
      {/* Full-opacity crop preview while re-framing */}
      {transform && showOverflow && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ overflow: "hidden", borderRadius: PHOTO_RADIUS }}
        >
          <img
            src={transform.src} alt="" draggable={false}
            style={{
              position: "absolute", top: "50%", left: "50%",
              width: "100%", height: "100%", objectFit,
              transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale})`,
              transformOrigin: "center center",
            }}
          />
        </div>
      )}
      {isEditing && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ outline: "2px dashed rgba(255,255,255,0.95)", outlineOffset: -2, boxShadow: "inset 0 0 0 1px rgba(79,141,83,0.55)" }}
        />
      )}
      <input
        id={fid} type="file" accept="image/*" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
      />
    </div>
  );
}

// ─── EditableText ─────────────────────────────────────────────────────────────

interface EditableTextProps {
  textKey: TextKey;
  style: TextStyle;
  active: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<TextStyle>) => void;
  previewScale: number;
  color: string;
  fontWeight?: number;
  shadow?: boolean;
  letterSpacing?: string;
  children: ReactNode;
  zIndex?: number;
}

function EditableText({
  textKey, style, active, onSelect, onChange, previewScale,
  color, fontWeight = 400, shadow, letterSpacing, children, zIndex = 7,
  interact = true,
}: EditableTextProps & { interact?: boolean }) {
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const latest = useRef(style);
  latest.current = style;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = (e.clientX - lastPos.current.x) / previewScale;
      const dy = (e.clientY - lastPos.current.y) / previewScale;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onChange({
        x: Math.round(latest.current.x + dx),
        y: Math.round(latest.current.y + dy),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onChange, previewScale]);

  return (
    <div
      data-text-key={textKey}
      style={{
        position: "absolute",
        left: style.x,
        top: style.y,
        transform: style.align === "right" ? "translateX(-100%)" : undefined,
        fontSize: style.size,
        fontWeight,
        color,
        lineHeight: 1.15,
        letterSpacing,
        textAlign: style.align,
        textShadow: shadow ? "0 2px 12px rgba(0,0,0,0.7)" : undefined,
        whiteSpace: "pre",
        cursor: interact ? (active ? "grab" : "pointer") : "default",
        userSelect: "none",
        zIndex,
        outline: active ? "2px dashed rgba(255,255,255,0.9)" : "2px solid transparent",
        outlineOffset: 4,
        maxWidth: style.align === "left" ? 520 : undefined,
        pointerEvents: interact ? "auto" : "none",
      }}
      onClick={(e) => { if (!interact) return; e.stopPropagation(); onSelect(); }}
      onMouseDown={(e) => {
        if (!interact || !active) return;
        dragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        e.stopPropagation();
      }}
      onWheel={(e) => {
        if (!interact || !active) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 2 : -2;
        onChange({ size: Math.max(8, Math.min(220, latest.current.size + delta)) });
      }}
    >
      {children}
    </div>
  );
}

// ─── EditableLayoutBox ────────────────────────────────────────────────────────

interface EditableLayoutBoxProps {
  box: LayoutBox;
  active: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<LayoutBox>) => void;
  previewScale: number;
  zIndex?: number;
  shadow?: string;
  radius?: number;
}

function EditableLayoutBox({
  box, active, onSelect, onChange, previewScale,
  zIndex = 5, shadow = "0 10px 20px 0 rgba(0,0,0,0.40)", radius = PBOX_RADIUS,
  interact = true,
}: EditableLayoutBoxProps & { interact?: boolean }) {
  const mode = useRef<"move" | "resize" | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const latest = useRef(box);
  latest.current = box;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!mode.current) return;
      const dx = (e.clientX - lastPos.current.x) / previewScale;
      const dy = (e.clientY - lastPos.current.y) / previewScale;
      lastPos.current = { x: e.clientX, y: e.clientY };
      if (mode.current === "move") {
        onChange({
          x: Math.round(latest.current.x + dx),
          y: Math.round(latest.current.y + dy),
        });
      } else {
        onChange({
          w: Math.max(40, Math.round(latest.current.w + dx)),
          h: Math.max(40, Math.round(latest.current.h + dy)),
        });
      }
    };
    const onUp = () => { mode.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onChange, previewScale]);

  return (
    <div
      style={{
        position: "absolute",
        left: box.x, top: box.y, width: box.w, height: box.h,
        background: "white", borderRadius: radius,
        boxShadow: shadow,
        zIndex,
        cursor: interact ? (active ? "grab" : "pointer") : "default",
        outline: active ? "2px dashed rgba(79,141,83,0.95)" : undefined,
        outlineOffset: 3,
        userSelect: "none",
        pointerEvents: interact ? "auto" : "none",
      }}
      onClick={(e) => { if (!interact) return; e.stopPropagation(); onSelect(); }}
      onMouseDown={(e) => {
        if (!interact || !active) return;
        mode.current = "move";
        lastPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        e.stopPropagation();
      }}
      onWheel={(e) => {
        if (!interact || !active) return;
        e.preventDefault();
        e.stopPropagation();
        const f = e.deltaY < 0 ? 1.04 : 1 / 1.04;
        onChange({
          w: Math.max(40, Math.round(latest.current.w * f)),
          h: Math.max(40, Math.round(latest.current.h * f)),
        });
      }}
    >
      {active && interact && (
        <div
          title="Ridimensiona"
          style={{
            position: "absolute", right: 2, bottom: 2,
            width: 14, height: 14, borderRadius: 2,
            background: GREEN, cursor: "nwse-resize",
            boxShadow: "0 0 0 2px white",
          }}
          onMouseDown={(e) => {
            mode.current = "resize";
            lastPos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

// ─── SlideCard ────────────────────────────────────────────────────────────────

interface SlideCardProps {
  slide: Slide;
  slideH: number;
  fontFam: string;
  textLayout: TextLayout;
  logoBox: LayoutBox;
  tesseratiBox: LayoutBox;
  activeEdit: ActiveEdit;
  onSetEdit: (e: ActiveEdit) => void;
  onUpdateBg: (t: ImgTransform) => void;
  onUpdateLogo: (t: ImgTransform) => void;
  onUpdateText: (key: TextKey, patch: Partial<TextStyle>) => void;
  onUpdateLogoBox: (patch: Partial<LayoutBox>) => void;
  onUpdateTesseratiBox: (patch: Partial<LayoutBox>) => void;
  onUploadBg: (f: File) => void;
  onUploadLogo: (f: File) => void;
  onBgGestureStart?: () => void;
  onLogoGestureStart?: () => void;
  scale: number;
}

function SlideCard({
  slide, slideH, fontFam, textLayout, logoBox, tesseratiBox, activeEdit, onSetEdit,
  onUpdateBg, onUpdateLogo, onUpdateText, onUpdateLogoBox, onUpdateTesseratiBox,
  onUploadBg, onUploadLogo, onBgGestureStart, onLogoGestureStart, scale,
}: SlideCardProps) {
  const ph  = photoRect(slideH);
  const pb1 = pbox1Rect(slideH);
  const ff = `"${fontFam}", sans-serif`;
  // Photo pan/zoom is always on unless a layout item (text/box/logo) is selected
  const layoutItemSelected =
    isTextKey(activeEdit) ||
    activeEdit === "tesseratiBox" ||
    activeEdit === "logoBox" ||
    activeEdit === "logo";
  const photoInteractive = !!slide.bg && !layoutItemSelected;
  const logoDragging = useRef(false);
  const logoLast = useRef({ x: 0, y: 0 });
  const logoLatest = useRef(logoBox);
  logoLatest.current = logoBox;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!logoDragging.current) return;
      const dx = (e.clientX - logoLast.current.x) / scale;
      const dy = (e.clientY - logoLast.current.y) / scale;
      logoLast.current = { x: e.clientX, y: e.clientY };
      onUpdateLogoBox({
        x: Math.round(logoLatest.current.x + dx),
        y: Math.round(logoLatest.current.y + dy),
      });
    };
    const onUp = () => { logoDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onUpdateLogoBox, scale]);

  return (
    <div
      style={{
        width: CARD_W, height: slideH, position: "relative", fontFamily: ff,
        transform: `scale(${scale})`, transformOrigin: "top left",
        background: GREEN, borderRadius: BR,
        overflow: photoInteractive ? "visible" : "hidden",
        flexShrink: 0,
      }}
      onClick={() => { if (activeEdit) onSetEdit(null); }}
    >
      {/* Crown — white PNG on green background */}
      <img
        src={simboloPSC} alt=""
        style={{
          position: "absolute",
          left: CARD_W / 2 - CROWN_W / 2, top: CROWN_Y,
          width: CROWN_W, height: CROWN_H,
          objectFit: "contain", pointerEvents: "none", zIndex: 5,
        }}
      />

      {/* Photo — pan/zoom always on; layout items use pointer-events only when selected */}
      <div
        style={{
          position: "absolute",
          left: ph.l, top: ph.t, width: ph.w, height: ph.h,
          borderRadius: PHOTO_RADIUS,
          overflow: photoInteractive ? "visible" : "hidden",
          background: "#c8c8c8",
          zIndex: 2,
          cursor: slide.bg ? "grab" : "pointer",
        }}
        onClick={(e) => { e.stopPropagation(); if (slide.bg) onSetEdit(null); }}
      >
        <DraggableImage
          transform={slide.bg} onUpdate={onUpdateBg} onUpload={onUploadBg}
          isEditing={!!slide.bg}
          label="Carica foto sfondo"
          objectFit="contain"
          previewScale={scale}
          onGestureStart={onBgGestureStart}
          showOverflow={photoInteractive}
        />
      </div>

      {/* PBOX1 — wide/short (back), soft shadow */}
      <div style={{
        position: "absolute",
        left: pb1.l, top: pb1.t, width: pb1.w, height: pb1.h,
        background: "white", borderRadius: PBOX_RADIUS,
        boxShadow: "0 10px 10px 0 rgba(0,0,0,0.25)",
        zIndex: 4, pointerEvents: "none",
      }} />

      {/* PBOX2 — narrow/tall (front), stronger shadow */}
      <EditableLayoutBox
        box={tesseratiBox}
        active={activeEdit === "tesseratiBox"}
        onSelect={() => onSetEdit(activeEdit === "tesseratiBox" ? null : "tesseratiBox")}
        onChange={onUpdateTesseratiBox}
        previewScale={scale}
        zIndex={5}
        interact={activeEdit === "tesseratiBox"}
      />

      <EditableText
        textKey="descrizione" style={textLayout.descrizione}
        active={activeEdit === "descrizione"}
        onSelect={() => onSetEdit("descrizione")}
        onChange={(p) => onUpdateText("descrizione", p)}
        previewScale={scale} color="white" fontWeight={700} shadow
        interact={activeEdit === "descrizione"}
      >
        {slide.descrizione || "Descrizione prodotto"}
      </EditableText>

      <EditableText
        textKey="labelTesserati" style={textLayout.labelTesserati}
        active={activeEdit === "labelTesserati"}
        onSelect={() => onSetEdit("labelTesserati")}
        onChange={(p) => onUpdateText("labelTesserati", p)}
        previewScale={scale} color={GREEN} fontWeight={600}
        interact={activeEdit === "labelTesserati"}
      >
        Prezzo Tesserati
      </EditableText>

      <EditableText
        textKey="prezzoTesserati" style={textLayout.prezzoTesserati}
        active={activeEdit === "prezzoTesserati"}
        onSelect={() => onSetEdit("prezzoTesserati")}
        onChange={(p) => onUpdateText("prezzoTesserati", p)}
        previewScale={scale} color={GREEN} fontWeight={700} letterSpacing="-1px"
        interact={activeEdit === "prezzoTesserati"}
      >
        {slide.prezzoTesserati ? `${slide.prezzoTesserati}€` : "0,00€"}
      </EditableText>

      <EditableText
        textKey="labelListino" style={textLayout.labelListino}
        active={activeEdit === "labelListino"}
        onSelect={() => onSetEdit("labelListino")}
        onChange={(p) => onUpdateText("labelListino", p)}
        previewScale={scale} color="#b7b7b7" fontWeight={400}
        interact={activeEdit === "labelListino"}
      >
        {"Prezzo\ndi listino"}
      </EditableText>

      <EditableText
        textKey="prezzoListino" style={textLayout.prezzoListino}
        active={activeEdit === "prezzoListino"}
        onSelect={() => onSetEdit("prezzoListino")}
        onChange={(p) => onUpdateText("prezzoListino", p)}
        previewScale={scale} color="#b7b7b7" fontWeight={400}
        interact={activeEdit === "prezzoListino"}
      >
        {slide.prezzoListino ? `${slide.prezzoListino}€` : "0,00€"}
      </EditableText>

      <EditableText
        textKey="sconto" style={textLayout.sconto}
        active={activeEdit === "sconto"}
        onSelect={() => onSetEdit("sconto")}
        onChange={(p) => onUpdateText("sconto", p)}
        previewScale={scale} color="white" fontWeight={400} letterSpacing="-2px"
        interact={activeEdit === "sconto"}
      >
        {slide.sconto || "-50%"}
      </EditableText>

      {/* Logo box (top-right) */}
      <div
        style={{
          position: "absolute",
          left: logoBox.x, top: logoBox.y, width: logoBox.w, height: logoBox.h,
          background: "white", borderRadius: LOGO_RADIUS,
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          overflow: "hidden", zIndex: 10,
          cursor: activeEdit === "logoBox" ? "grab" : activeEdit === "logo" ? "grab" : "pointer",
          outline: activeEdit === "logoBox" ? "2px dashed rgba(79,141,83,0.95)" : undefined,
          outlineOffset: 3,
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (activeEdit === "logo") return;
          onSetEdit(activeEdit === "logoBox" ? null : "logoBox");
        }}
        onMouseDown={(e) => {
          if (activeEdit !== "logoBox") return;
          logoDragging.current = true;
          logoLast.current = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DraggableImage
          transform={slide.logo} onUpdate={onUpdateLogo} onUpload={onUploadLogo}
          isEditing={activeEdit === "logo"} label="Carica logo"
          objectFit="contain" previewScale={scale}
          onGestureStart={onLogoGestureStart}
        />
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [slides, setSlides]         = useState<Slide[]>([mkSlide()]);
  const [current, setCurrent]       = useState(0);
  const [slideH, setSlideH]         = useState(DEFAULT_H);
  const [activeEdit, setActiveEdit] = useState<ActiveEdit>(null);
  const fontFam = "Sansumi";
  const [textLayout, setTextLayout] = useState<TextLayout>(() => defaultTextLayout());
  const [logoBox, setLogoBox]       = useState<LayoutBox>(() => defaultLogoBox());
  const [tesseratiBox, setTesseratiBox] = useState<LayoutBox>(() => defaultTesseratiBox());
  const [pasteText, setPasteText]   = useState("");
  const [importMsg, setImportMsg]   = useState("");
  const [previewScale, setPreviewScale] = useState(0.65);
  const [exporting, setExporting]   = useState(false);
  const [copiedLayout, setCopiedLayout] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const bgUndo = useRef<ImgTransform[]>([]);
  const bgRedo = useRef<ImgTransform[]>([]);
  const logoUndo = useRef<ImgTransform[]>([]);
  const logoRedo = useRef<ImgTransform[]>([]);

  const slide = slides[Math.min(current, slides.length - 1)];

  useEffect(() => {
    const compute = () => {
      if (!previewRef.current) return;
      const { width, height } = previewRef.current.getBoundingClientRect();
      setPreviewScale(Math.max(0.15, Math.min((width - 40) / CARD_W, (height - 40) / slideH, 1)));
    };
    compute();
    const obs = new ResizeObserver(compute);
    if (previewRef.current) obs.observe(previewRef.current);
    return () => obs.disconnect();
  }, [slideH]);

  // Clear image undo stacks when changing slide
  useEffect(() => {
    bgUndo.current = [];
    bgRedo.current = [];
    logoUndo.current = [];
    logoRedo.current = [];
  }, [slide.id]);

  const appendSlides = (imported: Slide[]) => {
    setSlides((prev) => {
      const next = [...prev, ...imported];
      setTimeout(() => setCurrent(prev.length), 0);
      return next;
    });
  };

  const updateSlide = useCallback((patch: Partial<Slide>) => {
    setSlides((prev) => prev.map((s, i) => (i === current ? { ...s, ...patch } : s)));
  }, [current]);

  const pushBgUndo = useCallback(() => {
    const bg = slides[current]?.bg;
    if (!bg) return;
    bgUndo.current.push({ ...bg });
    if (bgUndo.current.length > 60) bgUndo.current.shift();
    bgRedo.current = [];
  }, [slides, current]);

  const pushLogoUndo = useCallback(() => {
    const logo = slides[current]?.logo;
    if (!logo) return;
    logoUndo.current.push({ ...logo });
    if (logoUndo.current.length > 60) logoUndo.current.shift();
    logoRedo.current = [];
  }, [slides, current]);

  const undoImage = useCallback(() => {
    const s = slides[current];
    if (!s) return;
    if (activeEdit === "logo" || (!s.bg && s.logo)) {
      const prev = logoUndo.current.pop();
      if (!prev || !s.logo) return;
      logoRedo.current.push({ ...s.logo });
      updateSlide({ logo: prev });
      return;
    }
    const prev = bgUndo.current.pop();
    if (!prev || !s.bg) return;
    bgRedo.current.push({ ...s.bg });
    updateSlide({ bg: prev });
  }, [slides, current, activeEdit, updateSlide]);

  const redoImage = useCallback(() => {
    const s = slides[current];
    if (!s) return;
    if (activeEdit === "logo" || (!s.bg && s.logo)) {
      const next = logoRedo.current.pop();
      if (!next || !s.logo) return;
      logoUndo.current.push({ ...s.logo });
      updateSlide({ logo: next });
      return;
    }
    const next = bgRedo.current.pop();
    if (!next || !s.bg) return;
    bgUndo.current.push({ ...s.bg });
    updateSlide({ bg: next });
  }, [slides, current, activeEdit, updateSlide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redoImage();
        else undoImage();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redoImage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoImage, redoImage]);

  const updateText = useCallback((key: TextKey, patch: Partial<TextStyle>) => {
    setTextLayout((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const updateLogoBox = useCallback((patch: Partial<LayoutBox>) => {
    setLogoBox((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateTesseratiBox = useCallback((patch: Partial<LayoutBox>) => {
    setTesseratiBox((prev) => ({ ...prev, ...patch }));
  }, []);

  const uploadImage = async (file: File, key: "bg" | "logo") => {
    const src = await fileToDataUrl(file);
    updateSlide({ [key]: { src, x: 0, y: 0, scale: 1 } });
    // Foto: pan subito (nessuna selezione layout). Logo: entra in edit immagine.
    setActiveEdit(key === "logo" ? "logo" : null);
  };

  const copyLayoutValues = async () => {
    const payload = JSON.stringify({ slideHeight: slideH, textLayout, logoBox, tesseratiBox }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedLayout(true);
      setTimeout(() => setCopiedLayout(false), 2000);
    } catch {
      alert(payload);
    }
  };

  const handlePasteImport = () => {
    const imported = parseProductText(pasteText);
    if (!imported.length) {
      setImportMsg("");
      alert("Nessuna riga valida. Serve formato a 8 colonne (tab).");
      return;
    }
    appendSlides(imported);
    setPasteText("");
    setImportMsg(`${imported.length} slide create`);
  };

  const handleExcelImport = async (file: File) => {
    try {
      const imported = await parseXlsx(file);
      if (!imported.length) { alert("Nessun dato trovato."); return; }
      appendSlides(imported);
      setImportMsg(`${imported.length} slide create`);
    } catch { alert("Errore nella lettura del file Excel."); }
  };

  const addSlide = () => setSlides((prev) => { setCurrent(prev.length); return [...prev, mkSlide()]; });

  const deleteSlide = (idx: number) => {
    if (slides.length === 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== idx));
    setCurrent((c) => Math.min(c >= idx && c > 0 ? c - 1 : c, slides.length - 2));
  };

  const resetPos = () => {
    if (slide.bg)   updateSlide({ bg:   { ...slide.bg,   x: 0, y: 0, scale: 1 } });
    if (slide.logo) updateSlide({ logo: { ...slide.logo, x: 0, y: 0, scale: 1 } });
  };

  const saveProject = () => {
    const project = { version: 1, slideHeight: slideH, fontFamily: fontFam, textLayout, logoBox, tesseratiBox, slides };
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "progetto-slide.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const loadProject = async (file: File) => {
    try {
      const project = JSON.parse(await file.text());
      if (!Array.isArray(project.slides)) throw new Error();
      setSlides(project.slides);
      if (project.slideHeight) setSlideH(project.slideHeight);
      if (project.textLayout) setTextLayout({ ...defaultTextLayout(), ...project.textLayout });
      if (project.logoBox) setLogoBox({ ...defaultLogoBox(), ...project.logoBox });
      if (project.tesseratiBox) setTesseratiBox({ ...defaultTesseratiBox(), ...project.tesseratiBox });
      setCurrent(0); setActiveEdit(null);
    } catch { alert("Errore nel caricamento del progetto."); }
  };

  const handleExport = async () => {
    setExporting(true);
    try { await exportSlide(slide, slideH, fontFam, textLayout, logoBox, tesseratiBox); } finally { setExporting(false); }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      for (const s of slides) {
        await exportSlide(s, slideH, fontFam, textLayout, logoBox, tesseratiBox);
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally { setExporting(false); }
  };

  const selectedText = isTextKey(activeEdit) ? activeEdit : null;
  const photoMode =
    !!slide.bg &&
    !isTextKey(activeEdit) &&
    activeEdit !== "tesseratiBox" &&
    activeEdit !== "logoBox" &&
    activeEdit !== "logo";

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: "system-ui, -apple-system, sans-serif", background: "#e8e8ec" }}>

      {/* ── Slide list ── */}
      <div className="flex flex-col w-52 shrink-0" style={{ background: "#1b1b26", color: "white", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="p-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#555", marginBottom: 10 }}>SLIDE</div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold"
            style={{ background: GREEN, color: "white" }}
            onClick={addSlide}
          >
            <Plus size={14} /> Nuova slide
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {slides.map((s, i) => (
            <div
              key={s.id}
              className="group flex items-center gap-2 px-3 py-2.5 rounded cursor-pointer"
              style={{ background: i === current ? "rgba(255,255,255,0.09)" : "transparent" }}
              onClick={() => { setCurrent(i); setActiveEdit(null); }}
            >
              <div
                className="flex items-center justify-center w-6 h-6 rounded text-xs font-bold shrink-0"
                style={{ background: i === current ? GREEN : "#2a2a38", color: "white" }}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate" style={{ color: i === current ? "#fff" : "#888" }}>
                  {s.descrizione || `Slide ${i + 1}`}
                </div>
                {s.prezzoTesserati && <div className="text-xs" style={{ color: "#4a4a5a" }}>{s.prezzoTesserati}€</div>}
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                style={{ color: "#4a4a5a" }}
                onClick={(e) => { e.stopPropagation(); deleteSlide(i); }}
                onMouseOver={(e) => (e.currentTarget.style.color = "#ff6b6b")}
                onMouseOut={(e)  => (e.currentTarget.style.color = "#4a4a5a")}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Preview ── */}
      <div
        ref={previewRef}
        className="flex-1 flex items-center justify-center relative"
        style={{ overflow: photoMode ? "auto" : "hidden" }}
      >
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }} />
        <div style={{
          position: "relative",
          width: CARD_W * previewScale, height: slideH * previewScale,
          borderRadius: BR * previewScale,
          overflow: photoMode ? "visible" : "hidden",
          flexShrink: 0,
          boxShadow: "0 24px 72px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.1)",
        }}>
          <SlideCard
            slide={slide} slideH={slideH} fontFam={fontFam}
            textLayout={textLayout}
            logoBox={logoBox}
            tesseratiBox={tesseratiBox}
            activeEdit={activeEdit} onSetEdit={setActiveEdit}
            onUpdateBg={(t) => updateSlide({ bg: t })}
            onUpdateLogo={(t) => updateSlide({ logo: t })}
            onUpdateText={updateText}
            onUpdateLogoBox={updateLogoBox}
            onUpdateTesseratiBox={updateTesseratiBox}
            onUploadBg={(f) => uploadImage(f, "bg")}
            onUploadLogo={(f) => uploadImage(f, "logo")}
            onBgGestureStart={pushBgUndo}
            onLogoGestureStart={pushLogoUndo}
            scale={previewScale}
          />
        </div>
        {(photoMode || activeEdit) && (
          <div
            className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full text-xs text-white"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 30 }}
          >
            <Move size={12} /> Trascina
            {isTextKey(activeEdit)
              ? <>&nbsp;·&nbsp; <ZoomIn size={12} /> Scroll = size</>
              : activeEdit === "logoBox" || activeEdit === "tesseratiBox"
                ? <>&nbsp;·&nbsp; angolo = resize · scroll = scale</>
                : <>&nbsp;·&nbsp; <ZoomIn size={12} /> Scroll = zoom · Ctrl/⌘Z = undo</>}
            {!photoMode && activeEdit && slide.bg && <>&nbsp;·&nbsp; Click foto per tornare al pan</>}
          </div>
        )}
        <div className="absolute top-3 right-3 text-xs px-2 py-1 rounded" style={{ background: "rgba(0,0,0,0.28)", color: "rgba(255,255,255,0.55)" }}>
          {Math.round(previewScale * 100)}%
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="w-72 shrink-0 flex flex-col overflow-y-auto" style={{ background: "white", borderLeft: "1px solid #e6e6ea" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid #f2f2f4" }}>
          <div className="font-bold text-sm" style={{ color: "#111" }}>Slide Editor</div>
          <div className="text-xs mt-0.5" style={{ color: "#bbb" }}>Slide {current + 1}/{slides.length} · 800 × {slideH}px</div>
        </div>

        <Section label="Progetto">
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs font-medium hover:bg-gray-50 transition-colors" style={{ borderColor: "#e2e2e6", color: "#555" }} onClick={saveProject}>
              <Save size={13} /> Salva JSON
            </button>
            <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer" style={{ borderColor: "#e2e2e6", color: "#555" }}>
              <FolderOpen size={13} /> Carica JSON
              <input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = ""; }} />
            </label>
          </div>
        </Section>

        <Section label="Incolla prodotti">
          <textarea
            className="w-full px-2.5 py-2 text-xs border rounded outline-none font-mono resize-y"
            style={{ borderColor: "#e4e4e8", minHeight: 96 }}
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setImportMsg(""); }}
            onFocus={(e) => (e.target.style.borderColor = GREEN)}
            onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")}
            placeholder={"8025021222134\t78EVOLMSKIMPU\tEvolution Maschera...\t27\t€ 674,73\t€ 88,20\t€ 24,99\t71,67%"}
          />
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: GREEN }}
            disabled={!pasteText.trim()}
            onClick={handlePasteImport}
          >
            Crea slide
          </button>
          {importMsg && <p style={{ fontSize: 11, color: GREEN, margin: 0 }}>{importMsg}</p>}
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.5, margin: 0 }}>
            Col 3 descrizione · col 6 listino · col 7 tesserati · col 8 sconto (arrotondato)
          </p>
        </Section>

        <Section label="Importa Excel">
          <label className="flex items-center gap-2 px-3 py-2 rounded border border-dashed border-gray-300 hover:border-gray-400 cursor-pointer text-sm text-gray-500">
            <FileSpreadsheet size={14} />
            Carica .xlsx / .xls / .csv
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcelImport(f); e.target.value = ""; }} />
          </label>
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.5, margin: 0 }}>
            Header oppure 8 colonne posizionali come sopra
          </p>
        </Section>

        <Section label="Altezza slide">
          <div className="flex items-center gap-3">
            <input type="range" min={500} max={1400} step={5} value={slideH} className="flex-1" style={{ accentColor: GREEN }} onChange={(e) => setSlideH(Number(e.target.value))} />
            <span className="text-sm font-mono w-16 text-right" style={{ color: "#333" }}>{slideH}px</span>
          </div>
          <p style={{ fontSize: 10, color: "#ccc", margin: 0 }}>Larghezza fissa: 800px</p>
        </Section>

        <Section label="Layout testi">
          <div className="flex flex-wrap gap-1">
            {TEXT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="px-2 py-1 rounded text-[10px] border transition-colors"
                style={
                  selectedText === key
                    ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                    : { borderColor: "#e4e4e8", color: "#666" }
                }
                onClick={() => setActiveEdit(selectedText === key ? null : key)}
              >
                {TEXT_LABELS[key]}
              </button>
            ))}
            <button
              type="button"
              className="px-2 py-1 rounded text-[10px] border transition-colors"
              style={
                activeEdit === "logoBox"
                  ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                  : { borderColor: "#e4e4e8", color: "#666" }
              }
              onClick={() => setActiveEdit(activeEdit === "logoBox" ? null : "logoBox")}
            >
              Box logo
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-[10px] border transition-colors"
              style={
                activeEdit === "tesseratiBox"
                  ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                  : { borderColor: "#e4e4e8", color: "#666" }
              }
              onClick={() => setActiveEdit(activeEdit === "tesseratiBox" ? null : "tesseratiBox")}
            >
              Box Tesserati
            </button>
          </div>
          {selectedText && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                {(["size", "x", "y"] as const).map((field) => (
                  <label key={field} className="flex flex-col gap-0.5">
                    <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>{field}</span>
                    <input
                      type="number"
                      className="w-full px-2 py-1 text-xs border rounded font-mono outline-none"
                      style={{ borderColor: "#e4e4e8" }}
                      value={textLayout[selectedText][field]}
                      onChange={(e) => updateText(selectedText, { [field]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <input
                type="range"
                min={8}
                max={220}
                step={1}
                value={textLayout[selectedText].size}
                className="w-full"
                style={{ accentColor: GREEN }}
                onChange={(e) => updateText(selectedText, { size: Number(e.target.value) })}
              />
            </div>
          )}
          {(activeEdit === "logoBox" || activeEdit === "tesseratiBox") && (
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "w", "h"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-0.5">
                  <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>{field}</span>
                  <input
                    type="number"
                    className="w-full px-2 py-1 text-xs border rounded font-mono outline-none"
                    style={{ borderColor: "#e4e4e8" }}
                    value={(activeEdit === "logoBox" ? logoBox : tesseratiBox)[field]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (activeEdit === "logoBox") updateLogoBox({ [field]: v });
                      else updateTesseratiBox({ [field]: v });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded border text-xs"
              style={{ borderColor: "#e2e2e6", color: "#555" }}
              onClick={() => {
                setTextLayout(defaultTextLayout());
                setLogoBox(defaultLogoBox());
                setTesseratiBox(defaultTesseratiBox());
                setActiveEdit(null);
              }}
            >
              <RefreshCcw size={11} /> Reset layout
            </button>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded border text-xs"
              style={{ borderColor: copiedLayout ? GREEN : "#e2e2e6", color: copiedLayout ? GREEN : "#555" }}
              onClick={copyLayoutValues}
            >
              {copiedLayout ? "Copiato ✓" : "Copia valori"}
            </button>
          </div>
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.4, margin: 0 }}>
            Seleziona un chip per muovere testi/box. Sulla foto: pan e zoom subito, senza click.
          </p>
        </Section>

        <Section label="Dati slide">
          <Field label="Descrizione prodotto">
            <input className="w-full px-2.5 py-1.5 text-sm border rounded outline-none" style={{ borderColor: "#e4e4e8" }} value={slide.descrizione} onChange={(e) => updateSlide({ descrizione: e.target.value })} onFocus={(e) => (e.target.style.borderColor = GREEN)} onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")} placeholder="Es: Lindt Zero%  75g" />
          </Field>
          <Field label="Prezzo Tesserati (€)">
            <input className="w-full px-2.5 py-1.5 text-sm border rounded outline-none font-mono" style={{ borderColor: "#e4e4e8" }} value={slide.prezzoTesserati} onChange={(e) => updateSlide({ prezzoTesserati: e.target.value })} onFocus={(e) => (e.target.style.borderColor = GREEN)} onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")} placeholder="5,99" />
          </Field>
          <Field label="Prezzo di Listino (€)">
            <input className="w-full px-2.5 py-1.5 text-sm border rounded outline-none font-mono" style={{ borderColor: "#e4e4e8" }} value={slide.prezzoListino} onChange={(e) => updateSlide({ prezzoListino: e.target.value })} onFocus={(e) => (e.target.style.borderColor = GREEN)} onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")} placeholder="14,90" />
          </Field>
          <Field label="Testo sconto (es. «-50%» oppure «-50»)">
            <input className="w-full px-2.5 py-1.5 text-sm border rounded outline-none font-mono" style={{ borderColor: "#e4e4e8" }} value={slide.sconto} onChange={(e) => updateSlide({ sconto: e.target.value })} onFocus={(e) => (e.target.style.borderColor = GREEN)} onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")} placeholder="-50%" />
          </Field>
        </Section>

        <Section label="Immagini">
          <Field label="Foto sfondo">
            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-dashed border-gray-300 hover:border-gray-400 cursor-pointer text-gray-500">
                <Upload size={12} /> {slide.bg ? "Cambia foto" : "Carica foto"}
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await uploadImage(f, "bg"); e.target.value = ""; }} />
              </label>
              {slide.bg && !photoMode && (
                <button
                  className="px-2.5 py-1.5 text-xs rounded border font-medium transition-all"
                  style={{ background: "#edf7ee", borderColor: GREEN, color: GREEN }}
                  onClick={() => setActiveEdit(null)}
                >
                  Torna al pan
                </button>
              )}
            </div>
            {slide.bg && (
              <div className="flex flex-col gap-2 mt-1">
                <label className="flex flex-col gap-0.5">
                  <span style={{ fontSize: 10, color: "#aaa" }}>ZOOM {slide.bg.scale.toFixed(2)}×</span>
                  <input
                    type="range" min={0.15} max={6} step={0.01}
                    value={slide.bg.scale}
                    className="w-full" style={{ accentColor: GREEN }}
                    onChange={(e) => updateSlide({ bg: { ...slide.bg!, scale: Number(e.target.value) } })}
                    onMouseDown={() => { setActiveEdit(null); pushBgUndo(); }}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y"] as const).map((field) => (
                    <label key={field} className="flex flex-col gap-0.5">
                      <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>{field}</span>
                      <input
                        type="number"
                        className="w-full px-2 py-1 text-xs border rounded font-mono outline-none"
                        style={{ borderColor: "#e4e4e8" }}
                        value={Math.round(slide.bg![field])}
                        onChange={(e) => updateSlide({ bg: { ...slide.bg!, [field]: Number(e.target.value) } })}
                        onFocus={() => { setActiveEdit(null); pushBgUndo(); }}
                      />
                    </label>
                  ))}
                </div>
                <p style={{ fontSize: 10, color: "#ccc", margin: 0, lineHeight: 1.4 }}>
                  Pan/zoom subito sulla foto. Per muovere testi usa i chip sopra. Ctrl/⌘Z annulla.
                </p>
              </div>
            )}
          </Field>
          <Field label="Logo (box alto destra)">
            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-dashed border-gray-300 hover:border-gray-400 cursor-pointer text-gray-500">
                <Upload size={12} /> {slide.logo ? "Cambia logo" : "Carica logo"}
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await uploadImage(f, "logo"); e.target.value = ""; }} />
              </label>
              {slide.logo && (
                <button
                  className="px-2.5 py-1.5 text-xs rounded border font-medium transition-all"
                  style={activeEdit === "logo" ? { background: "#edf7ee", borderColor: GREEN, color: GREEN } : { borderColor: "#e0e0e4", color: "#888" }}
                  onClick={() => setActiveEdit(activeEdit === "logo" ? null : "logo")}
                >
                  {activeEdit === "logo" ? "Fine ✓" : "Muovi / Zoom"}
                </button>
              )}
            </div>
            {slide.logo && activeEdit === "logo" && (
              <div className="flex flex-col gap-2 mt-1">
                <label className="flex flex-col gap-0.5">
                  <span style={{ fontSize: 10, color: "#aaa" }}>ZOOM {slide.logo.scale.toFixed(2)}×</span>
                  <input
                    type="range" min={0.15} max={6} step={0.01}
                    value={slide.logo.scale}
                    className="w-full" style={{ accentColor: GREEN }}
                    onChange={(e) => updateSlide({ logo: { ...slide.logo!, scale: Number(e.target.value) } })}
                  />
                </label>
              </div>
            )}
          </Field>
          {(slide.bg || slide.logo) && (
            <button className="flex items-center gap-1.5 text-xs hover:opacity-60 transition-opacity" style={{ color: "#c0c0c4" }} onClick={resetPos}>
              <RefreshCcw size={11} /> Reset posizioni
            </button>
          )}
        </Section>

        <div className="p-4 mt-auto flex flex-col gap-2" style={{ borderTop: "1px solid #f2f2f4" }}>
          <button
            className="w-full flex items-center justify-center gap-2 py-3 rounded font-bold text-sm text-white disabled:opacity-50"
            style={{ background: GREEN }}
            disabled={exporting}
            onClick={handleExport}
          >
            <Download size={15} />
            {exporting ? "Esportando…" : "Esporta JPEG"}
          </button>
          <button
            className="w-full flex items-center justify-center gap-2 py-2 rounded text-xs border disabled:opacity-40"
            style={{ borderColor: "#e2e2e6", color: "#888" }}
            disabled={exporting}
            onClick={handleExportAll}
          >
            <Download size={12} /> Esporta tutte ({slides.length})
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar helpers ──────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-4 flex flex-col gap-3" style={{ borderBottom: "1px solid #f2f2f4" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.11em", color: "#c0c0c4", textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label style={{ fontSize: 11, color: "#aaa" }}>{label}</label>
      {children}
    </div>
  );
}
