import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import {
  Upload, Download, Plus, Trash2,
  RefreshCcw, Move, ZoomIn, Save, FolderOpen, ChevronDown, Sparkles, X,
  Layers, SlidersHorizontal, Image as ImageIcon,
} from "lucide-react";
import simboloPSC from "../imports/SimboloPSC.png";
import { downloadImageUrl, formatFalError, generateFromPhoto, toExportableSrc } from "../lib/fal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImgTransform {
  src: string;
  x: number;   // slide-space pan offset
  y: number;
  scale: number;
}

type TextKey =
  | "descrizione"
  | "labelTesserati"
  | "prezzoTesserati"
  | "labelListino"
  | "prezzoListino"
  | "sconto";

type TextAlign = "left" | "center" | "right";

type LayoutPreset = "standard" | "singleCenter";

interface TextStyle {
  size: number;
  x: number; // left, center, or right edge depending on align
  y: number; // top
  align: TextAlign;
  /** Drop shadow blur in px; 0 = off */
  shadowBlur: number;
  /** Drop shadow opacity 0–1 */
  shadowOpacity: number;
  /** Drop shadow Y offset in px */
  shadowOffsetY: number;
}

type TextLayout = Record<TextKey, TextStyle>;

interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SlideVisibility {
  listinoBox: boolean;
  labelListino: boolean;
  prezzoListino: boolean;
  sconto: boolean;
  labelTesserati: boolean;
  prezzoTesserati: boolean;
  descrizione: boolean;
  /** White rounded plate behind the logo image */
  logoBoxBg: boolean;
}

/** Freeform text line inside the tesserati / single box */
interface BoxLine {
  id: string;
  text: string;
  size: number;
  weight: number;
  color: string;
  align: TextAlign;
  letterSpacing: number;
  /** Fine vertical nudge from auto-stacked position */
  offsetY: number;
}

interface Slide {
  id: string;
  descrizione: string;
  prezzoTesserati: string;
  prezzoListino: string;
  sconto: string;
  labelTesseratiText: string;
  labelListinoText: string;
  bg: ImgTransform | null;
  logo: ImgTransform | null;
  textLayout: TextLayout;
  logoBox: LayoutBox;
  tesseratiBox: LayoutBox;
  listinoBox: LayoutBox;
  visibility: SlideVisibility;
  /** When true, render boxLines inside tesserati box instead of label+price */
  useBoxLines: boolean;
  boxLines: BoxLine[];
  /** Inner padding around freeform box lines (single-box layout) */
  boxPadding: number;
}

type ActiveEdit = "bg" | "logo" | "logoBox" | "tesseratiBox" | "listinoBox" | TextKey | null;

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

const PRESET_LABELS: Record<LayoutPreset, string> = {
  standard: "Standard (2 box)",
  singleCenter: "Box singolo",
};

const NO_SHADOW = { shadowBlur: 0, shadowOpacity: 0.65, shadowOffsetY: 0 } as const;

function defaultVisibility(): SlideVisibility {
  return {
    listinoBox: true,
    labelListino: true,
    prezzoListino: true,
    sconto: true,
    labelTesserati: true,
    prezzoTesserati: true,
    descrizione: true,
    logoBoxBg: true,
  };
}

/** Defaults calibrated at DEFAULT_H (685). x = left, center, or right edge when align=right. */
function defaultTextLayout(): TextLayout {
  return {
    descrizione:     { size: 22,  x: 38,  y: 464, align: "left",  shadowBlur: 12, shadowOpacity: 0.65, shadowOffsetY: 2 },
    labelTesserati:  { size: 25,  x: 32,  y: 532, align: "left",  ...NO_SHADOW },
    prezzoTesserati: { size: 61,  x: 299, y: 569, align: "right", ...NO_SHADOW },
    labelListino:    { size: 20,  x: 319, y: 566, align: "left",  ...NO_SHADOW },
    prezzoListino:   { size: 30,  x: 447, y: 611, align: "right", ...NO_SHADOW },
    sconto:          { size: 90,  x: 758, y: 532, align: "right", shadowBlur: 0, shadowOpacity: 0.65, shadowOffsetY: 2 },
  };
}

function mergeTextLayout(partial?: Partial<Record<TextKey, Partial<TextStyle>>>): TextLayout {
  const base = defaultTextLayout();
  if (!partial) return base;
  const out = { ...base };
  for (const key of TEXT_KEYS) {
    if (partial[key]) out[key] = { ...base[key], ...partial[key] };
  }
  return out;
}

function cssTextShadow(style: TextStyle): string | undefined {
  if (style.shadowBlur <= 0 || style.shadowOpacity <= 0) return undefined;
  return `0 ${style.shadowOffsetY}px ${style.shadowBlur}px rgba(0,0,0,${style.shadowOpacity})`;
}

function textAlignTransform(align: TextAlign): string | undefined {
  if (align === "right") return "translateX(-100%)";
  if (align === "center") return "translateX(-50%)";
  return undefined;
}

function defaultLogoBox(): LayoutBox {
  return { x: 500, y: 18, w: 284, h: 165 };
}

function defaultTesseratiBox(): LayoutBox {
  return { x: 21, y: 518, w: 289, h: 140 };
}

function defaultListinoBox(): LayoutBox {
  // Matches pbox1Rect(DEFAULT_H): bottom-anchored listino strip
  return { x: 33, y: 562, w: 421, h: 93 };
}

function mkBoxLine(partial?: Partial<Omit<BoxLine, "id">> & { id?: string }): BoxLine {
  return {
    id: partial?.id ?? uid(),
    text: partial?.text ?? "",
    size: partial?.size ?? 28,
    weight: partial?.weight ?? 600,
    color: partial?.color ?? GREEN,
    align: partial?.align ?? "center",
    letterSpacing: partial?.letterSpacing ?? 0,
    offsetY: partial?.offsetY ?? 0,
  };
}

function defaultSingleCenterBoxLines(): BoxLine[] {
  return [
    mkBoxLine({ text: "Offerta speciale", size: 26, weight: 600, color: GREEN }),
    mkBoxLine({ text: "tutto a 9,99€", size: 52, weight: 700, color: GREEN, letterSpacing: -1 }),
    mkBoxLine({ text: "fino al 12 aprile", size: 22, weight: 400, color: GREEN }),
  ];
}

function normalizeBoxLines(raw: any): BoxLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => mkBoxLine(line ?? {}));
}

/** Stack lines vertically centered in the box; returns absolute positions (top of each line). */
function boxLinePositions(box: LayoutBox, lines: BoxLine[], gap = 8, padding = 24) {
  const heights = lines.map((l) => l.size * 1.15);
  const total = heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, lines.length - 1);
  let y = box.y + (box.h - total) / 2;
  return lines.map((line, i) => {
    const top = y + line.offsetY;
    const x =
      line.align === "left" ? box.x + padding
      : line.align === "right" ? box.x + box.w - padding
      : box.x + box.w / 2;
    const pos = { line, x, y: top, h: heights[i] };
    y += heights[i] + gap;
    return pos;
  });
}

function measureBoxLinesContent(lines: BoxLine[], fontFam: string, gap = 8): { w: number; h: number } {
  if (!lines.length) return { w: 120, h: 60 };
  let maxW = 0;
  let totalH = 0;
  if (typeof document !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      lines.forEach((line, i) => {
        ctx.font = `${line.weight} ${line.size}px "${fontFam}", sans-serif`;
        const text = line.text || " ";
        let width = ctx.measureText(text).width;
        if (line.letterSpacing) width += line.letterSpacing * Math.max(0, text.length - 1);
        maxW = Math.max(maxW, width);
        totalH += line.size * 1.15;
        if (i < lines.length - 1) totalH += gap;
      });
    }
  }
  if (maxW === 0 && totalH === 0) {
    lines.forEach((line, i) => {
      maxW = Math.max(maxW, line.size * 0.55 * Math.max(1, (line.text || " ").length));
      totalH += line.size * 1.15;
      if (i < lines.length - 1) totalH += gap;
    });
  }
  const minOff = Math.min(0, ...lines.map((l) => l.offsetY));
  const maxOff = Math.max(0, ...lines.map((l) => l.offsetY));
  totalH += maxOff - minOff;
  return { w: maxW, h: totalH };
}

/** Auto-size white box around freeform lines, keeping the current center. */
function fitTesseratiBoxToLines(
  box: LayoutBox,
  lines: BoxLine[],
  padding: number,
  fontFam: string,
): LayoutBox {
  const content = measureBoxLinesContent(lines, fontFam);
  const w = Math.max(80, Math.round(content.w + padding * 2));
  const h = Math.max(60, Math.round(content.h + padding * 2));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    w,
    h,
    x: Math.round(Math.max(8, Math.min(CARD_W - w - 8, cx - w / 2))),
    y: Math.round(cy - h / 2),
  };
}

function layoutFromPreset(preset: LayoutPreset): Pick<Slide, "textLayout" | "logoBox" | "tesseratiBox" | "listinoBox" | "visibility" | "useBoxLines" | "boxLines" | "boxPadding"> {
  if (preset === "singleCenter") {
    return {
      logoBox: defaultLogoBox(),
      listinoBox: defaultListinoBox(),
      tesseratiBox: { x: 120, y: 470, w: 560, h: 185 },
      textLayout: {
        descrizione:     { size: 24, x: 400, y: 418, align: "center", shadowBlur: 12, shadowOpacity: 0.65, shadowOffsetY: 2 },
        labelTesserati:  { size: 28, x: 400, y: 498, align: "center", ...NO_SHADOW },
        prezzoTesserati: { size: 72, x: 400, y: 545, align: "center", ...NO_SHADOW },
        labelListino:    { size: 20, x: 319, y: 566, align: "left",  ...NO_SHADOW },
        prezzoListino:   { size: 30, x: 447, y: 611, align: "right", ...NO_SHADOW },
        sconto:          { size: 90, x: 758, y: 300, align: "right", shadowBlur: 0, shadowOpacity: 0.65, shadowOffsetY: 2 },
      },
      visibility: {
        ...defaultVisibility(),
        listinoBox: false,
        labelListino: false,
        prezzoListino: false,
        labelTesserati: false,
        prezzoTesserati: false,
        sconto: false,
      },
      useBoxLines: true,
      boxLines: defaultSingleCenterBoxLines(),
      boxPadding: 36,
    };
  }
  return {
    textLayout: defaultTextLayout(),
    logoBox: defaultLogoBox(),
    tesseratiBox: defaultTesseratiBox(),
    listinoBox: defaultListinoBox(),
    visibility: defaultVisibility(),
    useBoxLines: false,
    boxLines: [],
    boxPadding: 36,
  };
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
const COMPACT_MQ = "(max-width: 1023px)";
const MOBILE_NAV_H = "3.5rem";
/** Privilege Shopping Club Newsletter project file */
const PROJECT_EXT = "pscnl";
const PROJECT_KIND = "pscnl";

function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeISODate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00`);
  if (!Number.isFinite(t)) return null;
  return s;
}

function projectFileName(newsletterDate: string): string {
  const d = normalizeISODate(newsletterDate) || todayISODate();
  return `PSC-NL_${d}.${PROJECT_EXT}`;
}

function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_MQ).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_MQ);
    const apply = () => setCompact(mql.matches);
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);
  return compact;
}

/** Soft drop shadow of the green card on the white page (preview + export). */
interface CardShadow {
  blur: number;
  opacity: number;
  offsetY: number;
}

function defaultCardShadow(): CardShadow {
  return { blur: 7, opacity: 0.31, offsetY: 7 };
}

function cardShadowCss(s: CardShadow): string {
  return `0 ${s.offsetY}px ${s.blur}px rgba(0,0,0,${s.opacity})`;
}

/** Side/top inset from blur only — offset Y must not shrink the card. */
function cardShadowPad(s: CardShadow): number {
  return Math.max(8, Math.ceil(s.blur + 2));
}

/** Extra canvas height so a positive offset Y is not clipped. */
function cardShadowExtraHeight(s: CardShadow): number {
  return Math.max(0, Math.ceil(s.offsetY));
}

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
  const layout = layoutFromPreset("standard");
  return {
    id: uid(),
    descrizione: d?.descrizione ?? "",
    prezzoTesserati: d?.prezzoTesserati ?? "",
    prezzoListino: d?.prezzoListino ?? "",
    sconto: d?.sconto ?? "",
    labelTesseratiText: d?.labelTesseratiText ?? "Prezzo Tesserati",
    labelListinoText: d?.labelListinoText ?? "Prezzo\ndi listino",
    bg: d?.bg ?? null,
    logo: d?.logo ?? null,
    textLayout: mergeTextLayout(d?.textLayout),
    logoBox: { ...layout.logoBox, ...d?.logoBox },
    tesseratiBox: { ...layout.tesseratiBox, ...d?.tesseratiBox },
    listinoBox: { ...layout.listinoBox, ...d?.listinoBox },
    visibility: { ...layout.visibility, ...d?.visibility },
    useBoxLines: d?.useBoxLines ?? false,
    boxLines: d?.boxLines ? normalizeBoxLines(d.boxLines) : [],
    boxPadding: d?.boxPadding ?? 36,
  };
}

function normalizeSlide(
  raw: any,
  fallback?: Partial<Pick<Slide, "textLayout" | "logoBox" | "tesseratiBox" | "listinoBox" | "visibility" | "useBoxLines" | "boxLines" | "boxPadding">>,
): Slide {
  const slide = mkSlide({
    descrizione: raw?.descrizione,
    prezzoTesserati: raw?.prezzoTesserati,
    prezzoListino: raw?.prezzoListino,
    sconto: raw?.sconto,
    labelTesseratiText: raw?.labelTesseratiText,
    labelListinoText: raw?.labelListinoText,
    bg: raw?.bg ?? null,
    logo: raw?.logo ?? null,
    textLayout: raw?.textLayout ?? fallback?.textLayout,
    logoBox: raw?.logoBox ?? fallback?.logoBox,
    tesseratiBox: raw?.tesseratiBox ?? fallback?.tesseratiBox,
    listinoBox: raw?.listinoBox ?? fallback?.listinoBox,
    visibility: raw?.visibility ?? fallback?.visibility,
    useBoxLines: raw?.useBoxLines ?? fallback?.useBoxLines,
    boxLines: raw?.boxLines ?? fallback?.boxLines,
    boxPadding: raw?.boxPadding ?? fallback?.boxPadding,
  });
  if (raw?.id) slide.id = String(raw.id);
  return slide;
}

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function imageFileFromClipboard(e: ClipboardEvent): File | null {
  const data = e.clipboardData;
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of Array.from(data.files || [])) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
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

async function loadImg(src: string): Promise<HTMLImageElement> {
  const localSrc = await toExportableSrc(src);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Impossibile caricare l'immagine"));
    img.src = localSrc;
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
  opts: { color: string; weight: number; fontFam: string; lineGap?: number },
) {
  if (!text) return;
  const ff = `"${opts.fontFam}", sans-serif`;
  ctx.fillStyle = opts.color;
  ctx.font = `${opts.weight} ${style.size}px ${ff}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = "top";
  if (style.shadowBlur > 0 && style.shadowOpacity > 0) {
    ctx.shadowColor = `rgba(0,0,0,${style.shadowOpacity})`;
    ctx.shadowBlur = style.shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = style.shadowOffsetY;
  }
  const lines = text.split("\n");
  const gap = opts.lineGap ?? style.size * 1.3;
  lines.forEach((line, i) => {
    ctx.fillText(line, style.x, style.y + i * gap);
  });
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

async function renderSlideBlob(slide: Slide, H: number, fontFam: string, cardShadow: CardShadow = defaultCardShadow()): Promise<Blob> {
  await document.fonts.ready;

  const W = CARD_W;
  const pad = cardShadowPad(cardShadow);
  const extraH = cardShadowExtraHeight(cardShadow);
  const contentScale = (W - pad * 2) / W;
  const scaledH = H * contentScale;
  const vPad = (H - scaledH) / 2;

  // Final image: width always 800; height grows only if offset Y needs room below
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H + extraH;
  const ctx = canvas.getContext("2d")!;
  const ph = photoRect(H);
  const { textLayout, logoBox, listinoBox, visibility: vis } = slide;
  const tesseratiBox = slide.useBoxLines
    ? fitTesseratiBoxToLines(slide.tesseratiBox, slide.boxLines, slide.boxPadding ?? 36, fontFam)
    : slide.tesseratiBox;
  const { x: LOGO_X, y: LOGO_Y, w: LOGO_W, h: LOGO_H } = logoBox;

  // 1. White page (margin visible around the card)
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Green card inset by blur-only pad; offset Y may spill into extraH
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${cardShadow.opacity})`;
  ctx.shadowBlur = cardShadow.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = cardShadow.offsetY;
  ctx.fillStyle = GREEN;
  rrect(ctx, pad, vPad, W - pad * 2, scaledH, BR * contentScale);
  ctx.fill();
  ctx.restore();

  // Content scaled into the inset card
  ctx.save();
  ctx.translate(pad, vPad);
  ctx.scale(contentScale, contentScale);

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

  // 4. Listino box (back) — optional
  if (vis.listinoBox) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 10;
    ctx.fillStyle = "white";
    rrect(ctx, listinoBox.x, listinoBox.y, listinoBox.w, listinoBox.h, PBOX_RADIUS); ctx.fill();
    ctx.restore();
  }

  // 5. Tesserati box (front)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.40)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
  ctx.fillStyle = "white";
  rrect(ctx, tesseratiBox.x, tesseratiBox.y, tesseratiBox.w, tesseratiBox.h, PBOX_RADIUS); ctx.fill();
  ctx.restore();

  // Texts (layout-driven)
  if (vis.descrizione && slide.descrizione) {
    drawLayoutText(ctx, textLayout.descrizione, slide.descrizione, {
      color: "white", weight: 700, fontFam,
    });
  }
  if (slide.useBoxLines && slide.boxLines.length) {
    const positions = boxLinePositions(tesseratiBox, slide.boxLines, 8, slide.boxPadding ?? 36);
    for (const pos of positions) {
      const { line } = pos;
      if (!line.text) continue;
      ctx.fillStyle = line.color;
      ctx.font = `${line.weight} ${line.size}px "${fontFam}", sans-serif`;
      ctx.textAlign = line.align;
      ctx.textBaseline = "top";
      if (line.letterSpacing) {
        (ctx as any).letterSpacing = `${line.letterSpacing}px`;
      }
      ctx.fillText(line.text, pos.x, pos.y);
      (ctx as any).letterSpacing = "0px";
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  } else {
    if (vis.labelTesserati) {
      drawLayoutText(ctx, textLayout.labelTesserati, slide.labelTesseratiText || "Prezzo Tesserati", {
        color: GREEN, weight: 600, fontFam,
      });
    }
    if (vis.prezzoTesserati && slide.prezzoTesserati) {
      drawLayoutText(ctx, textLayout.prezzoTesserati, `${slide.prezzoTesserati}€`, {
        color: GREEN, weight: 700, fontFam,
      });
    }
  }
  if (vis.labelListino) {
    drawLayoutText(ctx, textLayout.labelListino, slide.labelListinoText || "Prezzo\ndi listino", {
      color: "#b7b7b7", weight: 400, fontFam,
    });
  }
  if (vis.prezzoListino && slide.prezzoListino) {
    drawLayoutText(ctx, textLayout.prezzoListino, `${slide.prezzoListino}€`, {
      color: "#b7b7b7", weight: 400, fontFam,
    });
  }
  if (vis.sconto && slide.sconto) {
    drawLayoutText(ctx, textLayout.sconto, slide.sconto, {
      color: "white", weight: 400, fontFam,
    });
  }

  // 11. Crown
  try {
    const crownImg = await loadImg(simboloPSC);
    ctx.drawImage(crownImg, CARD_W / 2 - CROWN_W / 2, CROWN_Y, CROWN_W, CROWN_H);
  } catch (_) {}

  // 12. Logo box (white rounded rect) — optional
  if (vis.logoBoxBg) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    ctx.fillStyle = "white";
    rrect(ctx, LOGO_X, LOGO_Y, LOGO_W, LOGO_H, LOGO_RADIUS); ctx.fill();
    ctx.restore();
  }

  // 13. Logo image (inside logo box area) — same math as preview (contain + center scale)
  if (slide.logo) {
    ctx.save();
    rrect(ctx, LOGO_X, LOGO_Y, LOGO_W, LOGO_H, LOGO_RADIUS); ctx.clip();
    const li = await loadImg(slide.logo.src);
    drawContain(ctx, li, LOGO_X, LOGO_Y, LOGO_W, LOGO_H, slide.logo.x, slide.logo.y, slide.logo.scale);
    ctx.restore();
  }

  ctx.restore(); // end card translate

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Export fallito"));
      else resolve(blob);
    }, "image/jpeg", 0.95);
  });
}

function safeExportName(name: string, fallback = "slide"): string {
  const s = String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return s || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportSlide(slide: Slide, H: number, fontFam: string, cardShadow: CardShadow = defaultCardShadow()) {
  const blob = await renderSlideBlob(slide, H, fontFam, cardShadow);
  downloadBlob(blob, `${safeExportName(slide.descrizione)}.jpg`);
}

async function exportAllSlidesZip(
  slides: Slide[],
  H: number,
  fontFam: string,
  cardShadow: CardShadow = defaultCardShadow(),
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Map<string, number>();

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const blob = await renderSlideBlob(s, H, fontFam, cardShadow);
    const base = safeExportName(s.descrizione, `slide-${i + 1}`);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    zip.file(n === 1 ? `${base}.jpg` : `${base}-${n}.jpg`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, "slide.zip");
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
  const previewScaleRef = useRef(previewScale);
  previewScaleRef.current = previewScale;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const gestureStarted = useRef(false);
  const wheelTimer = useRef<number | null>(null);
  const fid = `fu-${label.replace(/\W/g, "")}`;

  const beginGesture = () => {
    if (gestureStarted.current) return;
    gestureStarted.current = true;
    onGestureStartRef.current?.();
  };

  // Pointer + pinch (touch/pen/mouse). Native listeners so preventDefault works on iOS.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist: number | null = null;
    let lastPinchMid: { x: number; y: number } | null = null;

    const pan = (dx: number, dy: number) => {
      const t = latest.current;
      if (!t) return;
      const ps = previewScaleRef.current || 1;
      const next = { ...t, x: t.x + dx / ps, y: t.y + dy / ps };
      latest.current = next;
      onUpdateRef.current(next);
    };

    const zoom = (factor: number) => {
      const t = latest.current;
      if (!t) return;
      const nextScale = Math.max(0.15, Math.min(12, t.scale * factor));
      const next = { ...t, scale: Math.round(nextScale * 1000) / 1000 };
      latest.current = next;
      onUpdateRef.current(next);
    };

    const onDown = (e: PointerEvent) => {
      if (!editingRef.current || !latest.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      beginGesture();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
      } else {
        dragging.current = false;
        lastPinchDist = null;
        lastPinchMid = null;
      }
      if (e.pointerType !== "mouse") e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !latest.current) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.values()];
      if (pts.length >= 2) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (lastPinchDist && lastPinchDist > 4) zoom(dist / lastPinchDist);
        if (lastPinchMid) pan(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y);
        lastPinchDist = dist;
        lastPinchMid = mid;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (dragging.current) {
        pan(e.clientX - lastPos.current.x, e.clientY - lastPos.current.y);
        lastPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onEnd = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      lastPinchDist = null;
      lastPinchMid = null;
      if (pointers.size === 1) {
        const rem = [...pointers.values()][0];
        dragging.current = true;
        lastPos.current = rem;
      } else {
        dragging.current = false;
        gestureStarted.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!editingRef.current || pointers.size === 0) return;
      e.preventDefault();
    };

    el.addEventListener("pointerdown", onDown, { passive: false });
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      el.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

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
      const t = latest.current;
      const nextScale = Math.max(0.15, Math.min(12, t.scale * f));
      const next = { ...t, scale: Math.round(nextScale * 1000) / 1000 };
      latest.current = next;
      onUpdateRef.current(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{
        cursor: isEditing ? "grab" : transform ? "pointer" : "default",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: isEditing ? "none" : "auto",
        overflow: showOverflow ? "visible" : "hidden",
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
  letterSpacing?: string;
  value: string;
  onValueChange: (value: string) => void;
  displayValue?: string;
  placeholder?: string;
  multiline?: boolean;
  zIndex?: number;
}

function EditableText({
  textKey, style, active, onSelect, onChange, previewScale,
  color, fontWeight = 400, letterSpacing,
  value, onValueChange, displayValue, placeholder = "",
  multiline = false, zIndex = 7,
}: EditableTextProps) {
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const latest = useRef(style);
  latest.current = style;
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const valueAtEditStart = useRef(value);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || editing) return;
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
  }, [onChange, previewScale, editing]);

  useEffect(() => {
    if (!editing || !editRef.current) return;
    editRef.current.textContent = valueAtEditStart.current;
    editRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editRef.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const commitEdit = () => {
    if (!editing || !editRef.current) return;
    const next = (editRef.current.innerText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const cleaned = multiline ? next.replace(/\n$/, "") : next.replace(/\n/g, " ").trimEnd();
    onValueChange(cleaned);
    setEditing(false);
  };

  const shown = displayValue ?? (value || placeholder);

  return (
    <div
      data-text-key={textKey}
      style={{
        position: "absolute",
        left: style.x,
        top: style.y,
        transform: textAlignTransform(style.align),
        fontSize: style.size,
        fontWeight,
        color,
        lineHeight: 1.15,
        letterSpacing,
        textAlign: style.align,
        textShadow: editing ? undefined : cssTextShadow(style),
        whiteSpace: "pre",
        cursor: editing ? "text" : active ? "grab" : "pointer",
        userSelect: editing ? "text" : "none",
        zIndex: editing ? 20 : zIndex,
        outline: editing
          ? "2px solid rgba(79,141,83,0.95)"
          : active
            ? "2px dashed rgba(255,255,255,0.9)"
            : "2px solid transparent",
        outlineOffset: 4,
        maxWidth: style.align === "right" ? undefined : 560,
        pointerEvents: "auto",
        minWidth: editing ? 24 : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (editing) return;
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect();
        valueAtEditStart.current = value;
        setEditing(true);
      }}
      onMouseDown={(e) => {
        if (editing) {
          e.stopPropagation();
          return;
        }
        if (!active) return;
        dragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        e.stopPropagation();
      }}
      onWheel={(e) => {
        if (editing || !active) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 2 : -2;
        onChange({ size: Math.max(8, Math.min(220, latest.current.size + delta)) });
      }}
    >
      {editing ? (
        <div
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          style={{
            outline: "none",
            whiteSpace: multiline ? "pre-wrap" : "pre",
            caretColor: color,
            minWidth: 20,
            minHeight: "1em",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            } else if (e.key === "Enter" && !multiline) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commitEdit();
            }
          }}
        />
      ) : (
        shown
      )}
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
  allowResize?: boolean;
}

function EditableLayoutBox({
  box, active, onSelect, onChange, previewScale,
  zIndex = 5, shadow = "0 10px 20px 0 rgba(0,0,0,0.40)", radius = PBOX_RADIUS,
  interact = true, allowResize = true,
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
      } else if (allowResize) {
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
  }, [onChange, previewScale, allowResize]);

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
        if (!interact || !active || !allowResize) return;
        e.preventDefault();
        e.stopPropagation();
        const f = e.deltaY < 0 ? 1.04 : 1 / 1.04;
        onChange({
          w: Math.max(40, Math.round(latest.current.w * f)),
          h: Math.max(40, Math.round(latest.current.h * f)),
        });
      }}
    >
      {active && interact && allowResize && (
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

// ─── InlineBoxLine (freeform box text, Figma-like edit) ───────────────────────

function InlineBoxLine({
  line, x, y, maxWidth, selected, onSelect, onChangeText, onChangeSize,
}: {
  line: BoxLine;
  x: number;
  y: number;
  maxWidth: number;
  selected: boolean;
  onSelect: () => void;
  onChangeText: (text: string) => void;
  onChangeSize: (size: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const startVal = useRef(line.text);

  useEffect(() => {
    if (!editing || !editRef.current) return;
    editRef.current.textContent = startVal.current;
    editRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editRef.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const commit = () => {
    if (!editing || !editRef.current) return;
    const next = (editRef.current.innerText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
    onChangeText(next);
    setEditing(false);
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: textAlignTransform(line.align),
        fontSize: line.size,
        fontWeight: line.weight,
        color: line.color,
        letterSpacing: line.letterSpacing ? `${line.letterSpacing}px` : undefined,
        lineHeight: 1.15,
        textAlign: line.align,
        whiteSpace: "pre",
        zIndex: editing ? 20 : 8,
        cursor: editing ? "text" : "pointer",
        userSelect: editing ? "text" : "none",
        outline: editing
          ? "2px solid rgba(79,141,83,0.95)"
          : selected
            ? "2px dashed rgba(79,141,83,0.95)"
            : "2px solid transparent",
        outlineOffset: 4,
        maxWidth,
        pointerEvents: "auto",
        minWidth: editing ? 24 : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (editing) return;
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect();
        startVal.current = line.text;
        setEditing(true);
      }}
      onWheel={(e) => {
        if (editing || !selected) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 2 : -2;
        onChangeSize(Math.max(12, Math.min(120, line.size + delta)));
      }}
    >
      {editing ? (
        <div
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          style={{ outline: "none", whiteSpace: "pre-wrap", caretColor: line.color, minWidth: 20 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        line.text || "Testo…"
      )}
    </div>
  );
}

// ─── SlideCard ────────────────────────────────────────────────────────────────

interface SlideCardProps {
  slide: Slide;
  slideH: number;
  fontFam: string;
  activeEdit: ActiveEdit;
  onSetEdit: (e: ActiveEdit) => void;
  selectedBoxLineId: string | null;
  onSelectBoxLine: (id: string | null) => void;
  onUpdateSlide: (patch: Partial<Slide>) => void;
  onUpdateBg: (t: ImgTransform) => void;
  onUpdateLogo: (t: ImgTransform) => void;
  onUpdateText: (key: TextKey, patch: Partial<TextStyle>) => void;
  onUpdateLogoBox: (patch: Partial<LayoutBox>) => void;
  onUpdateTesseratiBox: (patch: Partial<LayoutBox>) => void;
  onUpdateListinoBox: (patch: Partial<LayoutBox>) => void;
  onUpdateBoxLine: (id: string, patch: Partial<BoxLine>) => void;
  onUploadBg: (f: File) => void;
  onUploadLogo: (f: File) => void;
  onBgGestureStart?: () => void;
  onLogoGestureStart?: () => void;
  scale: number;
}

function SlideCard({
  slide, slideH, fontFam, activeEdit, onSetEdit,
  selectedBoxLineId, onSelectBoxLine, onUpdateSlide,
  onUpdateBg, onUpdateLogo, onUpdateText, onUpdateLogoBox, onUpdateTesseratiBox, onUpdateListinoBox,
  onUpdateBoxLine,
  onUploadBg, onUploadLogo, onBgGestureStart, onLogoGestureStart, scale,
}: SlideCardProps) {
  const ph  = photoRect(slideH);
  const { textLayout, logoBox, listinoBox, visibility: vis } = slide;
  const boxPadding = slide.boxPadding ?? 36;
  const tesseratiBox = slide.useBoxLines
    ? fitTesseratiBoxToLines(slide.tesseratiBox, slide.boxLines, boxPadding, fontFam)
    : slide.tesseratiBox;
  const ff = `"${fontFam}", sans-serif`;
  const layoutItemSelected =
    isTextKey(activeEdit) ||
    activeEdit === "tesseratiBox" ||
    activeEdit === "listinoBox" ||
    activeEdit === "logoBox" ||
    activeEdit === "logo" ||
    !!selectedBoxLineId;
  const photoInteractive = !!slide.bg && !layoutItemSelected;
  const logoMode = useRef<"move" | "resize" | null>(null);
  const logoLast = useRef({ x: 0, y: 0 });
  const logoLatest = useRef(logoBox);
  logoLatest.current = logoBox;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!logoMode.current) return;
      const dx = (e.clientX - logoLast.current.x) / scale;
      const dy = (e.clientY - logoLast.current.y) / scale;
      logoLast.current = { x: e.clientX, y: e.clientY };
      if (logoMode.current === "move") {
        onUpdateLogoBox({
          x: Math.round(logoLatest.current.x + dx),
          y: Math.round(logoLatest.current.y + dy),
        });
      } else {
        onUpdateLogoBox({
          w: Math.max(40, Math.round(logoLatest.current.w + dx)),
          h: Math.max(40, Math.round(logoLatest.current.h + dy)),
        });
      }
    };
    const onUp = () => { logoMode.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
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
        touchAction: "none",
      }}
      onClick={() => { if (activeEdit) onSetEdit(null); onSelectBoxLine(null); }}
    >
      <img
        src={simboloPSC} alt=""
        style={{
          position: "absolute",
          left: CARD_W / 2 - CROWN_W / 2, top: CROWN_Y,
          width: CROWN_W, height: CROWN_H,
          objectFit: "contain", pointerEvents: "none", zIndex: 5,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: ph.l, top: ph.t, width: ph.w, height: ph.h,
          borderRadius: PHOTO_RADIUS,
          overflow: photoInteractive ? "visible" : "hidden",
          background: "#c8c8c8",
          zIndex: 2,
          cursor: slide.bg ? "grab" : "pointer",
          touchAction: slide.bg ? "none" : "auto",
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

      {vis.listinoBox && (
        <EditableLayoutBox
          box={listinoBox}
          active={activeEdit === "listinoBox"}
          onSelect={() => onSetEdit(activeEdit === "listinoBox" ? null : "listinoBox")}
          onChange={onUpdateListinoBox}
          previewScale={scale}
          zIndex={4}
          shadow="0 10px 10px 0 rgba(0,0,0,0.25)"
          interact={activeEdit === "listinoBox"}
        />
      )}

      <EditableLayoutBox
        box={tesseratiBox}
        active={activeEdit === "tesseratiBox"}
        onSelect={() => onSetEdit(activeEdit === "tesseratiBox" ? null : "tesseratiBox")}
        onChange={(patch) => {
          if (slide.useBoxLines) {
            // Keep auto size; only persist position (and sync fitted w/h)
            onUpdateTesseratiBox({
              x: patch.x ?? tesseratiBox.x,
              y: patch.y ?? tesseratiBox.y,
              w: tesseratiBox.w,
              h: tesseratiBox.h,
            });
          } else {
            onUpdateTesseratiBox(patch);
          }
        }}
        previewScale={scale}
        zIndex={5}
        interact={activeEdit === "tesseratiBox"}
        allowResize={!slide.useBoxLines}
      />

      {vis.descrizione && (
        <EditableText
          textKey="descrizione" style={textLayout.descrizione}
          active={activeEdit === "descrizione"}
          onSelect={() => { onSelectBoxLine(null); onSetEdit("descrizione"); }}
          onChange={(p) => onUpdateText("descrizione", p)}
          previewScale={scale} color="white" fontWeight={700}
          value={slide.descrizione}
          onValueChange={(v) => onUpdateSlide({ descrizione: v })}
          placeholder="Descrizione prodotto"
          multiline
        />
      )}

      {slide.useBoxLines ? (
        boxLinePositions(tesseratiBox, slide.boxLines, 8, boxPadding).map(({ line, x, y }) => (
          <InlineBoxLine
            key={line.id}
            line={line}
            x={x}
            y={y}
            maxWidth={Math.max(40, tesseratiBox.w - boxPadding * 2)}
            selected={selectedBoxLineId === line.id}
            onSelect={() => {
              onSetEdit(null);
              onSelectBoxLine(selectedBoxLineId === line.id ? null : line.id);
            }}
            onChangeText={(text) => onUpdateBoxLine(line.id, { text })}
            onChangeSize={(size) => onUpdateBoxLine(line.id, { size })}
          />
        ))
      ) : (
        <>
          {vis.labelTesserati && (
            <EditableText
              textKey="labelTesserati" style={textLayout.labelTesserati}
              active={activeEdit === "labelTesserati"}
              onSelect={() => { onSelectBoxLine(null); onSetEdit("labelTesserati"); }}
              onChange={(p) => onUpdateText("labelTesserati", p)}
              previewScale={scale} color={GREEN} fontWeight={600}
              value={slide.labelTesseratiText}
              onValueChange={(v) => onUpdateSlide({ labelTesseratiText: v })}
              placeholder="Prezzo Tesserati"
              multiline
            />
          )}

          {vis.prezzoTesserati && (
            <EditableText
              textKey="prezzoTesserati" style={textLayout.prezzoTesserati}
              active={activeEdit === "prezzoTesserati"}
              onSelect={() => { onSelectBoxLine(null); onSetEdit("prezzoTesserati"); }}
              onChange={(p) => onUpdateText("prezzoTesserati", p)}
              previewScale={scale} color={GREEN} fontWeight={700} letterSpacing="-1px"
              value={slide.prezzoTesserati}
              onValueChange={(v) => onUpdateSlide({ prezzoTesserati: cleanPrice(v) })}
              displayValue={slide.prezzoTesserati ? `${slide.prezzoTesserati}€` : "0,00€"}
              placeholder="0,00"
            />
          )}
        </>
      )}

      {vis.labelListino && (
        <EditableText
          textKey="labelListino" style={textLayout.labelListino}
          active={activeEdit === "labelListino"}
          onSelect={() => { onSelectBoxLine(null); onSetEdit("labelListino"); }}
          onChange={(p) => onUpdateText("labelListino", p)}
          previewScale={scale} color="#b7b7b7" fontWeight={400}
          value={slide.labelListinoText}
          onValueChange={(v) => onUpdateSlide({ labelListinoText: v })}
          placeholder={"Prezzo\ndi listino"}
          multiline
        />
      )}

      {vis.prezzoListino && (
        <EditableText
          textKey="prezzoListino" style={textLayout.prezzoListino}
          active={activeEdit === "prezzoListino"}
          onSelect={() => { onSelectBoxLine(null); onSetEdit("prezzoListino"); }}
          onChange={(p) => onUpdateText("prezzoListino", p)}
          previewScale={scale} color="#b7b7b7" fontWeight={400}
          value={slide.prezzoListino}
          onValueChange={(v) => onUpdateSlide({ prezzoListino: cleanPrice(v) })}
          displayValue={slide.prezzoListino ? `${slide.prezzoListino}€` : "0,00€"}
          placeholder="0,00"
        />
      )}

      {vis.sconto && (
        <EditableText
          textKey="sconto" style={textLayout.sconto}
          active={activeEdit === "sconto"}
          onSelect={() => { onSelectBoxLine(null); onSetEdit("sconto"); }}
          onChange={(p) => onUpdateText("sconto", p)}
          previewScale={scale} color="white" fontWeight={400} letterSpacing="-2px"
          value={slide.sconto}
          onValueChange={(v) => onUpdateSlide({ sconto: v })}
          placeholder="-50%"
        />
      )}

      <div
        style={{
          position: "absolute",
          left: logoBox.x, top: logoBox.y, width: logoBox.w, height: logoBox.h,
          background: vis.logoBoxBg ? "white" : "transparent",
          borderRadius: LOGO_RADIUS,
          boxShadow: vis.logoBoxBg ? "0 6px 20px rgba(0,0,0,0.18)" : undefined,
          overflow: "hidden", zIndex: 10,
          cursor: activeEdit === "logoBox" ? "grab" : activeEdit === "logo" || slide.logo ? "grab" : "pointer",
          outline: activeEdit === "logoBox" ? "2px dashed rgba(79,141,83,0.95)" : undefined,
          outlineOffset: 3,
          touchAction: slide.logo ? "none" : "auto",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (activeEdit === "logo") return;
          // Touch: keep pan/pinch on the logo image. Box move stays in the editor.
          if (window.matchMedia("(pointer: coarse)").matches) return;
          onSetEdit(activeEdit === "logoBox" ? null : "logoBox");
        }}
        onPointerDown={(e) => {
          if (activeEdit !== "logoBox") return;
          logoMode.current = "move";
          logoLast.current = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          e.stopPropagation();
        }}
        onWheel={(e) => {
          if (activeEdit !== "logoBox") return;
          e.preventDefault();
          e.stopPropagation();
          const f = e.deltaY < 0 ? 1.04 : 1 / 1.04;
          onUpdateLogoBox({
            w: Math.max(40, Math.round(logoLatest.current.w * f)),
            h: Math.max(40, Math.round(logoLatest.current.h * f)),
          });
        }}
      >
        <DraggableImage
          transform={slide.logo} onUpdate={onUpdateLogo} onUpload={onUploadLogo}
          isEditing={!!slide.logo && activeEdit !== "logoBox"} label="Carica logo"
          objectFit="contain" previewScale={scale}
          onGestureStart={onLogoGestureStart}
        />
        {activeEdit === "logoBox" && (
          <div
            title="Ridimensiona"
            style={{
              position: "absolute", right: 2, bottom: 2,
              width: 14, height: 14, borderRadius: 2,
              background: GREEN, cursor: "nwse-resize",
              boxShadow: "0 0 0 2px white",
              zIndex: 2,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              logoMode.current = "resize";
              logoLast.current = { x: e.clientX, y: e.clientY };
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [slides, setSlides]         = useState<Slide[]>([mkSlide()]);
  const [current, setCurrent]       = useState(0);
  const [slideH, setSlideH]         = useState(DEFAULT_H);
  const [cardShadow, setCardShadow] = useState<CardShadow>(() => defaultCardShadow());
  const [activeEdit, setActiveEdit] = useState<ActiveEdit>(null);
  const fontFam = "Sansumi";
  const [pasteText, setPasteText]   = useState("");
  const [importMsg, setImportMsg]   = useState("");
  const [previewScale, setPreviewScale] = useState(0.65);
  const [exporting, setExporting]   = useState(false);
  const [copiedLayout, setCopiedLayout] = useState(false);
  const [selectedBoxLineId, setSelectedBoxLineId] = useState<string | null>(null);
  const [falPrompt, setFalPrompt] = useState("");
  const [falGenerating, setFalGenerating] = useState(false);
  const [falModalOpen, setFalModalOpen] = useState(false);
  const [falResultUrl, setFalResultUrl] = useState<string | null>(null);
  const [falSourceSrc, setFalSourceSrc] = useState<string | null>(null);
  const [falError, setFalError] = useState("");
  const [falStatus, setFalStatus] = useState("");
  const compact = useCompactLayout();
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [newsletterDate, setNewsletterDate] = useState(todayISODate);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveDateDraft, setSaveDateDraft] = useState(todayISODate);
  const [pasteImage, setPasteImage] = useState<{ file: File; preview: string } | null>(null);
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
      const padX = compact ? 16 : 40;
      const padY = compact ? 88 : 40;
      setPreviewScale(Math.max(0.12, Math.min((width - padX) / CARD_W, (height - padY) / slideH, 1)));
    };
    compute();
    const obs = new ResizeObserver(compute);
    if (previewRef.current) obs.observe(previewRef.current);
    return () => obs.disconnect();
  }, [slideH, compact]);

  useEffect(() => {
    if (!compact) {
      setSlidesOpen(false);
      setEditorOpen(false);
    }
  }, [compact]);

  // Clear image undo stacks when changing slide
  useEffect(() => {
    bgUndo.current = [];
    bgRedo.current = [];
    logoUndo.current = [];
    logoRedo.current = [];
    setSelectedBoxLineId(null);
    setFalPrompt((slide.descrizione || "").split("\n")[0].trim());
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

  const runFalGenerate = async (sourceSrc: string, prompt: string) => {
    setFalGenerating(true);
    setFalError("");
    setFalStatus("Avvio…");
    setFalSourceSrc(sourceSrc);
    setFalResultUrl(null);
    setFalModalOpen(true);
    setSlidesOpen(false);
    setEditorOpen(false);
    try {
      const url = await generateFromPhoto(sourceSrc, prompt, setFalStatus);
      setFalResultUrl(url);
      setFalStatus("");
    } catch (err) {
      console.error("[fal]", err);
      const msg = formatFalError(err);
      setFalError(msg);
      setFalStatus("");
    } finally {
      setFalGenerating(false);
    }
  };

  const handleFalGenerate = async () => {
    if (!slide.bg?.src || falGenerating) return;
    await runFalGenerate(slide.bg.src, falPrompt);
  };

  const handleFalRipeti = async () => {
    const src = falSourceSrc || slide.bg?.src;
    if (!src || falGenerating) return;
    await runFalGenerate(src, falPrompt);
  };

  const handleFalSostituisci = async () => {
    if (!falResultUrl) return;
    try {
      const src = await toExportableSrc(falResultUrl);
      updateSlide({ bg: { src, x: 0, y: 0, scale: 1 } });
      setFalModalOpen(false);
      setFalResultUrl(null);
      setFalError("");
    } catch (err) {
      console.error("[fal] sostituisci", err);
      setFalError("Impossibile usare l'immagine generata. Riprova o scaricala e caricala a mano.");
    }
  };

  const handleFalAnnulla = () => {
    setFalModalOpen(false);
    setFalResultUrl(null);
    setFalError("");
  };

  const handleFalScarica = async () => {
    if (!falResultUrl) return;
    try {
      const name = (falPrompt || slide.descrizione || "generata").split("\n")[0].trim().slice(0, 60) || "generata";
      await downloadImageUrl(falResultUrl, `${name}.jpg`);
    } catch {
      alert("Download fallito");
    }
  };

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
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      return { ...s, textLayout: { ...s.textLayout, [key]: { ...s.textLayout[key], ...patch } } };
    }));
  }, [current]);

  const updateLogoBox = useCallback((patch: Partial<LayoutBox>) => {
    setSlides((prev) => prev.map((s, i) => i === current ? { ...s, logoBox: { ...s.logoBox, ...patch } } : s));
  }, [current]);

  const updateTesseratiBox = useCallback((patch: Partial<LayoutBox>) => {
    setSlides((prev) => prev.map((s, i) => i === current ? { ...s, tesseratiBox: { ...s.tesseratiBox, ...patch } } : s));
  }, [current]);

  const updateListinoBox = useCallback((patch: Partial<LayoutBox>) => {
    setSlides((prev) => prev.map((s, i) => i === current ? { ...s, listinoBox: { ...s.listinoBox, ...patch } } : s));
  }, [current]);

  const updateVisibility = useCallback((patch: Partial<SlideVisibility>) => {
    setSlides((prev) => prev.map((s, i) => i === current ? { ...s, visibility: { ...s.visibility, ...patch } } : s));
  }, [current]);

  const applyPreset = useCallback((preset: LayoutPreset) => {
    const layout = layoutFromPreset(preset);
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      if (preset === "singleCenter") {
        return {
          ...s,
          ...layout,
          boxLines: s.boxLines.length ? s.boxLines : layout.boxLines,
        };
      }
      return { ...s, ...layout, useBoxLines: false };
    }));
    setActiveEdit(null);
    setSelectedBoxLineId(null);
  }, [current]);

  const updateBoxLine = useCallback((id: string, patch: Partial<BoxLine>) => {
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      return {
        ...s,
        boxLines: s.boxLines.map((line) => line.id === id ? { ...line, ...patch } : line),
      };
    }));
  }, [current]);

  const addBoxLine = useCallback(() => {
    const line = mkBoxLine({ text: "Nuova riga", size: 28, weight: 600, color: GREEN });
    setSlides((prev) => prev.map((s, i) => i === current ? { ...s, boxLines: [...s.boxLines, line], useBoxLines: true } : s));
    setSelectedBoxLineId(line.id);
  }, [current]);

  const removeBoxLine = useCallback((id: string) => {
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      return { ...s, boxLines: s.boxLines.filter((l) => l.id !== id) };
    }));
    setSelectedBoxLineId((cur) => cur === id ? null : cur);
  }, [current]);

  const moveBoxLine = useCallback((id: string, dir: -1 | 1) => {
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      const idx = s.boxLines.findIndex((l) => l.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= s.boxLines.length) return s;
      const next = [...s.boxLines];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...s, boxLines: next };
    }));
  }, [current]);

  const setUseBoxLines = useCallback((on: boolean) => {
    setSlides((prev) => prev.map((s, i) => {
      if (i !== current) return s;
      if (!on) return { ...s, useBoxLines: false };
      return {
        ...s,
        useBoxLines: true,
        boxLines: s.boxLines.length ? s.boxLines : defaultSingleCenterBoxLines(),
        visibility: {
          ...s.visibility,
          labelTesserati: false,
          prezzoTesserati: false,
        },
      };
    }));
    if (!on) setSelectedBoxLineId(null);
  }, [current]);

  const uploadImage = async (file: File, key: "bg" | "logo") => {
    const src = await fileToDataUrl(file);
    updateSlide({ [key]: { src, x: 0, y: 0, scale: 1 } });
    // Foto: pan subito (nessuna selezione layout). Logo: entra in edit immagine.
    setActiveEdit(key === "logo" ? "logo" : null);
  };

  const closePasteImage = () => {
    setPasteImage((cur) => {
      if (cur?.preview) URL.revokeObjectURL(cur.preview);
      return null;
    });
  };

  const applyPastedImage = async (key: "bg" | "logo") => {
    if (!pasteImage) return;
    const file = pasteImage.file;
    closePasteImage();
    setSlidesOpen(false);
    setEditorOpen(false);
    await uploadImage(file, key);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      setPasteImage((cur) => {
        if (cur?.preview) URL.revokeObjectURL(cur.preview);
        return { file, preview: URL.createObjectURL(file) };
      });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!pasteImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePasteImage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pasteImage]);

  const copyLayoutValues = async () => {
    const payload = JSON.stringify({
      slideHeight: slideH,
      textLayout: slide.textLayout,
      logoBox: slide.logoBox,
      tesseratiBox: slide.tesseratiBox,
      listinoBox: slide.listinoBox,
      visibility: slide.visibility,
    }, null, 2);
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

  const openSaveModal = () => {
    setSaveDateDraft(normalizeISODate(newsletterDate) || todayISODate());
    setSaveModalOpen(true);
  };

  const confirmSaveProject = () => {
    const date = normalizeISODate(saveDateDraft) || todayISODate();
    setNewsletterDate(date);
    const project = {
      kind: PROJECT_KIND,
      version: 3,
      newsletterDate: date,
      slideHeight: slideH,
      fontFamily: fontFam,
      cardShadow,
      slides,
    };
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = projectFileName(date);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSaveModalOpen(false);
  };

  const loadProject = async (file: File) => {
    try {
      const project = JSON.parse(await file.text());
      if (!Array.isArray(project.slides)) throw new Error();
      const fallback = {
        textLayout: project.textLayout ? mergeTextLayout(project.textLayout) : undefined,
        logoBox: project.logoBox,
        tesseratiBox: project.tesseratiBox,
        listinoBox: project.listinoBox,
        visibility: project.visibility,
      };
      setSlides(project.slides.map((raw: any) => normalizeSlide(raw, fallback)));
      if (project.slideHeight) setSlideH(project.slideHeight);
      if (project.cardShadow) setCardShadow({ ...defaultCardShadow(), ...project.cardShadow });
      const loadedDate = normalizeISODate(String(project.newsletterDate ?? ""));
      setNewsletterDate(loadedDate || todayISODate());
      setCurrent(0); setActiveEdit(null);
    } catch { alert("Errore nel caricamento del progetto."); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportSlide(slide, slideH, fontFam, cardShadow);
    } catch (err) {
      console.error("[export]", err);
      alert("Errore durante l'export JPEG.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      await exportAllSlidesZip(slides, slideH, fontFam, cardShadow);
    } catch {
      alert("Errore durante l'export ZIP.");
    } finally {
      setExporting(false);
    }
  };

  const selectedText = isTextKey(activeEdit) ? activeEdit : null;
  const photoMode =
    !!slide.bg &&
    !isTextKey(activeEdit) &&
    activeEdit !== "tesseratiBox" &&
    activeEdit !== "listinoBox" &&
    activeEdit !== "logoBox" &&
    activeEdit !== "logo" &&
    !selectedBoxLineId;

  const toggleSlides = () => {
    setSlidesOpen((open) => !open);
    setEditorOpen(false);
  };
  const toggleEditor = () => {
    setEditorOpen((open) => !open);
    setSlidesOpen(false);
  };
  const closePanels = () => {
    setSlidesOpen(false);
    setEditorOpen(false);
  };

  const navPad = `calc(${MOBILE_NAV_H} + env(safe-area-inset-bottom, 0px))`;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex overflow-hidden"
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#e8e8ec",
        height: "100dvh",
        paddingBottom: compact ? navPad : 0,
      }}
    >

      {/* ── Slide list ── */}
      {compact && slidesOpen && (
        <button
          type="button"
          aria-label="Chiudi elenco slide"
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.4)", bottom: navPad }}
          onClick={closePanels}
        />
      )}
      <div
        className={
          compact
            ? `fixed z-50 top-0 left-0 flex flex-col overflow-hidden w-[min(18rem,88vw)] transition-transform duration-200 ease-out ${slidesOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"}`
            : "flex flex-col w-52 shrink-0"
        }
        style={{
          background: "#1b1b26",
          color: "white",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          height: compact ? `calc(100dvh - ${navPad})` : undefined,
        }}
      >
        <div className="p-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between gap-2" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#555" }}>SLIDE</div>
            {compact && (
              <button type="button" onClick={closePanels} style={{ color: "#888" }} aria-label="Chiudi">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold"
            style={{ background: GREEN, color: "white" }}
            onClick={() => { addSlide(); if (compact) closePanels(); }}
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
              onClick={() => { setCurrent(i); setActiveEdit(null); if (compact) closePanels(); }}
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
                className={compact ? "shrink-0" : "opacity-0 group-hover:opacity-100 transition-opacity shrink-0"}
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
        className="flex-1 min-w-0 flex items-center justify-center relative"
        style={{
          overflow: photoMode && !compact ? "auto" : "hidden",
          touchAction: compact ? "none" : undefined,
        }}
      >
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }} />
        {(() => {
          const pad = cardShadowPad(cardShadow);
          const extraH = cardShadowExtraHeight(cardShadow);
          const contentScale = (CARD_W - pad * 2) / CARD_W;
          const scaledH = slideH * contentScale;
          const vPad = (slideH - scaledH) / 2;
          const ps = previewScale;
          return (
            <div style={{
              position: "relative",
              width: CARD_W * ps,
              height: (slideH + extraH) * ps,
              background: "white",
              flexShrink: 0,
            }}>
              <div style={{
                position: "absolute",
                left: pad * ps,
                top: vPad * ps,
                width: (CARD_W - pad * 2) * ps,
                height: scaledH * ps,
                borderRadius: BR * contentScale * ps,
                overflow: photoMode ? "visible" : "hidden",
                boxShadow: cardShadowCss(cardShadow),
                background: GREEN,
              }}>
                <SlideCard
                  slide={slide} slideH={slideH} fontFam={fontFam}
                  activeEdit={activeEdit} onSetEdit={setActiveEdit}
                  selectedBoxLineId={selectedBoxLineId}
                  onSelectBoxLine={setSelectedBoxLineId}
                  onUpdateSlide={updateSlide}
                  onUpdateBg={(t) => updateSlide({ bg: t })}
                  onUpdateLogo={(t) => updateSlide({ logo: t })}
                  onUpdateText={updateText}
                  onUpdateLogoBox={updateLogoBox}
                  onUpdateTesseratiBox={updateTesseratiBox}
                  onUpdateListinoBox={updateListinoBox}
                  onUpdateBoxLine={updateBoxLine}
                  onUploadBg={(f) => uploadImage(f, "bg")}
                  onUploadLogo={(f) => uploadImage(f, "logo")}
                  onBgGestureStart={pushBgUndo}
                  onLogoGestureStart={pushLogoUndo}
                  scale={ps * contentScale}
                />
                {falGenerating && (
                  <div className="fal-generating-overlay">
                    <div className="fal-generating-label">{falStatus || "Generazione in corso…"}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {slide.bg && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-xl shadow-sm"
            style={{
              zIndex: 35,
              background: "rgba(255,255,255,0.94)",
              border: "1px solid #e4e4e8",
              maxWidth: "min(560px, calc(100% - 16px))",
              width: "100%",
            }}
          >
            <input
              type="text"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border outline-none"
              style={{ borderColor: "#e4e4e8", color: "#333" }}
              value={falPrompt}
              onChange={(e) => setFalPrompt(e.target.value)}
              placeholder="Descrivi il prodotto…"
              disabled={falGenerating}
            />
            <button
              type="button"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
              style={{ background: GREEN }}
              disabled={falGenerating}
              onClick={handleFalGenerate}
            >
              <Sparkles size={13} />
              {falGenerating ? "…" : compact ? "Genera" : "Genera da questa"}
            </button>
          </div>
        )}
        {!compact && (photoMode || activeEdit || selectedBoxLineId) && (
          <div
            className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full text-xs text-white"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 30 }}
          >
            <Move size={12} /> Click = seleziona · Doppio click = modifica testo
            {isTextKey(activeEdit) || selectedBoxLineId
              ? <>&nbsp;·&nbsp; <ZoomIn size={12} /> Scroll = size · Trascina = sposta</>
              : activeEdit === "logoBox" || activeEdit === "tesseratiBox" || activeEdit === "listinoBox"
                ? <>&nbsp;·&nbsp; angolo = resize · scroll = scale</>
                : photoMode ? <>&nbsp;·&nbsp; <ZoomIn size={12} /> Scroll = zoom · Ctrl/⌘Z = undo</> : null}
            {!photoMode && activeEdit && slide.bg && <>&nbsp;·&nbsp; Click foto per tornare al pan</>}
          </div>
        )}
        <div
          className="absolute text-xs px-2 py-1 rounded"
          style={{
            top: compact ? undefined : 12,
            right: 12,
            bottom: compact ? 12 : undefined,
            background: "rgba(0,0,0,0.28)",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {Math.round(previewScale * 100)}%
        </div>
      </div>

      {/* ── Controls ── */}
      {compact && editorOpen && (
        <button
          type="button"
          aria-label="Chiudi editor"
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.4)", bottom: navPad }}
          onClick={closePanels}
        />
      )}
      <div
        className={
          compact
            ? `fixed z-50 top-0 right-0 flex flex-col w-[min(20rem,92vw)] overflow-hidden transition-transform duration-200 ease-out ${editorOpen ? "translate-x-0" : "translate-x-full pointer-events-none"}`
            : "w-72 shrink-0 flex flex-col overflow-hidden"
        }
        style={{
          background: "white",
          borderLeft: "1px solid #e6e6ea",
          height: compact ? `calc(100dvh - ${navPad})` : undefined,
        }}
      >
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid #f2f2f4" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-sm" style={{ color: "#111" }}>Slide Editor</div>
              <div className="text-xs mt-0.5" style={{ color: "#bbb" }}>Slide {current + 1}/{slides.length} · 800 × {slideH}px</div>
            </div>
            {compact && (
              <button type="button" onClick={closePanels} style={{ color: "#999" }} aria-label="Chiudi editor">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
        <Section label="Progetto" accent="#d8efe0" accentText="#4a8f62" defaultOpen>
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs font-medium hover:bg-gray-50 transition-colors" style={{ borderColor: "#e2e2e6", color: "#555" }} onClick={openSaveModal}>
              <Save size={13} /> Salva .pscnl
            </button>
            <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer" style={{ borderColor: "#e2e2e6", color: "#555" }}>
              <FolderOpen size={13} /> Apri
              <input type="file" accept=".pscnl,.json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = ""; }} />
            </label>
          </div>
          <p style={{ fontSize: 10, color: "#bbb", margin: 0, lineHeight: 1.45 }}>
            File progetto <span style={{ fontFamily: "ui-monospace, monospace" }}>.pscnl</span>
            {newsletterDate ? ` · NL ${newsletterDate}` : ""}
          </p>
        </Section>

        <Section label="Incolla prodotti" accent="#ffe8d4" accentText="#b07a45" defaultOpen>
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

        <Section label="Dati slide" accent="#e8e0f5" accentText="#6f5f9a" defaultOpen>
          <Field label="Descrizione prodotto">
            <textarea
              className="w-full px-2.5 py-1.5 text-sm border rounded outline-none resize-y"
              style={{ borderColor: "#e4e4e8", minHeight: 64, lineHeight: 1.35 }}
              rows={3}
              value={slide.descrizione}
              onChange={(e) => updateSlide({ descrizione: e.target.value })}
              onFocus={(e) => (e.target.style.borderColor = GREEN)}
              onBlur={(e) => (e.target.style.borderColor = "#e4e4e8")}
              placeholder={"Es: Lindt Zero%\n75g"}
            />
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

        <Section label="Altezza slide" accent="#fff1c9" accentText="#9a7f35">
          <div className="flex items-center gap-3">
            <input type="range" min={500} max={1400} step={5} value={slideH} className="flex-1" style={{ accentColor: GREEN }} onChange={(e) => setSlideH(Number(e.target.value))} />
            <span className="text-sm font-mono w-16 text-right" style={{ color: "#333" }}>{slideH}px</span>
          </div>
          <p style={{ fontSize: 10, color: "#ccc", margin: 0 }}>Larghezza fissa: 800px</p>
        </Section>

        <Section label="Ombra card verde" accent="#e2f4e6" accentText="#3f8f55">
          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between">
              <span style={{ fontSize: 10, color: "#888" }}>Blur</span>
              <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{cardShadow.blur}px</span>
            </div>
            <input
              type="range" min={0} max={80} step={1}
              value={cardShadow.blur} className="w-full" style={{ accentColor: GREEN }}
              onChange={(e) => setCardShadow((s) => ({ ...s, blur: Number(e.target.value) }))}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between">
              <span style={{ fontSize: 10, color: "#888" }}>Opacità</span>
              <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{Math.round(cardShadow.opacity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={60} step={1}
              value={Math.round(cardShadow.opacity * 100)} className="w-full" style={{ accentColor: GREEN }}
              onChange={(e) => setCardShadow((s) => ({ ...s, opacity: Number(e.target.value) / 100 }))}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between">
              <span style={{ fontSize: 10, color: "#888" }}>Offset Y</span>
              <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{cardShadow.offsetY}px</span>
            </div>
            <input
              type="range" min={-20} max={40} step={1}
              value={cardShadow.offsetY} className="w-full" style={{ accentColor: GREEN }}
              onChange={(e) => setCardShadow((s) => ({ ...s, offsetY: Number(e.target.value) }))}
            />
          </label>
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.4, margin: 0 }}>
            Larghezza JPEG 800px. Il blur riduce un po’ la card; l’offset Y allunga solo l’altezza.
          </p>
        </Section>

        <Section label="Layout slide" accent="#fde2e4" accentText="#a85f6a">
          <div className="flex gap-1">
            {(["standard", "singleCenter"] as LayoutPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                className="flex-1 px-2 py-1.5 rounded text-[10px] border font-medium"
                style={{ borderColor: "#e4e4e8", color: "#444" }}
                onClick={() => applyPreset(preset)}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.4, margin: 0 }}>
            Il preset vale solo per la slide corrente. Poi puoi muovere/nascondere tutto.
          </p>

          <div className="flex flex-col gap-1.5">
            <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>Visibilità</span>
            {([
              ["logoBoxBg", "Box bianco logo"],
              ["listinoBox", "Box listino"],
              ["labelListino", "Label listino"],
              ["prezzoListino", "Prezzo listino"],
              ["sconto", "Sconto"],
              ["descrizione", "Descrizione"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-2 text-xs" style={{ color: "#555" }}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={slide.visibility[key]}
                  onChange={(e) => updateVisibility({ [key]: e.target.checked })}
                  style={{ accentColor: GREEN }}
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {TEXT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="px-2 py-1 rounded text-[10px] border transition-colors"
                style={
                  selectedText === key
                    ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                    : { borderColor: "#e4e4e8", color: "#666", opacity: slide.visibility[key as keyof SlideVisibility] === false ? 0.4 : 1 }
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
            {slide.visibility.listinoBox && (
              <button
                type="button"
                className="px-2 py-1 rounded text-[10px] border transition-colors"
                style={
                  activeEdit === "listinoBox"
                    ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                    : { borderColor: "#e4e4e8", color: "#666" }
                }
                onClick={() => setActiveEdit(activeEdit === "listinoBox" ? null : "listinoBox")}
              >
                Box Listino
              </button>
            )}
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
                      value={slide.textLayout[selectedText][field]}
                      onChange={(e) => updateText(selectedText, { [field]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-1">
                {(["left", "center", "right"] as TextAlign[]).map((align) => (
                  <button
                    key={align}
                    type="button"
                    className="flex-1 px-2 py-1 rounded text-[10px] border"
                    style={
                      slide.textLayout[selectedText].align === align
                        ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                        : { borderColor: "#e4e4e8", color: "#666" }
                    }
                    onClick={() => updateText(selectedText, { align })}
                  >
                    {align === "left" ? "Sinistra" : align === "center" ? "Centro" : "Destra"}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={8}
                max={220}
                step={1}
                value={slide.textLayout[selectedText].size}
                className="w-full"
                style={{ accentColor: GREEN }}
                onChange={(e) => updateText(selectedText, { size: Number(e.target.value) })}
              />
              {(selectedText === "descrizione" || selectedText === "sconto") && (
                <div className="flex flex-col gap-2 pt-1" style={{ borderTop: "1px solid #eee" }}>
                  <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>Drop shadow</span>
                  <label className="flex flex-col gap-0.5">
                    <div className="flex justify-between">
                      <span style={{ fontSize: 10, color: "#888" }}>Blur</span>
                      <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{slide.textLayout[selectedText].shadowBlur}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={slide.textLayout[selectedText].shadowBlur}
                      className="w-full"
                      style={{ accentColor: GREEN }}
                      onChange={(e) => updateText(selectedText, { shadowBlur: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <div className="flex justify-between">
                      <span style={{ fontSize: 10, color: "#888" }}>Opacità</span>
                      <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{Math.round(slide.textLayout[selectedText].shadowOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(slide.textLayout[selectedText].shadowOpacity * 100)}
                      className="w-full"
                      style={{ accentColor: GREEN }}
                      onChange={(e) => updateText(selectedText, { shadowOpacity: Number(e.target.value) / 100 })}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <div className="flex justify-between">
                      <span style={{ fontSize: 10, color: "#888" }}>Offset Y</span>
                      <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{slide.textLayout[selectedText].shadowOffsetY}px</span>
                    </div>
                    <input
                      type="range"
                      min={-20}
                      max={40}
                      step={1}
                      value={slide.textLayout[selectedText].shadowOffsetY}
                      className="w-full"
                      style={{ accentColor: GREEN }}
                      onChange={(e) => updateText(selectedText, { shadowOffsetY: Number(e.target.value) })}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          {(activeEdit === "logoBox" || activeEdit === "tesseratiBox" || activeEdit === "listinoBox") && (
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "w", "h"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-0.5">
                  <span style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>{field}</span>
                  <input
                    type="number"
                    className="w-full px-2 py-1 text-xs border rounded font-mono outline-none"
                    style={{ borderColor: "#e4e4e8" }}
                    value={
                      activeEdit === "logoBox"
                        ? slide.logoBox[field]
                        : activeEdit === "listinoBox"
                          ? slide.listinoBox[field]
                          : slide.tesseratiBox[field]
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (activeEdit === "logoBox") updateLogoBox({ [field]: v });
                      else if (activeEdit === "listinoBox") updateListinoBox({ [field]: v });
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
              onClick={() => applyPreset("standard")}
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
            Seleziona un chip per muovere testi/box. Allineamento e visibilità sono per slide.
          </p>
        </Section>

        <Section label="Testi nel box" accent="#d5f0ee" accentText="#3f857e">
          <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "#555" }}>
            <span>Editor righe libere</span>
            <input
              type="checkbox"
              checked={slide.useBoxLines}
              onChange={(e) => setUseBoxLines(e.target.checked)}
              style={{ accentColor: GREEN }}
            />
          </label>
          <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.4, margin: 0 }}>
            Ideale per Box singolo: ogni riga ha testo, size e spessore propri.
          </p>
          {slide.useBoxLines && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-0.5">
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: "#888" }}>Margin box</span>
                  <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{slide.boxPadding ?? 36}px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={80}
                  step={1}
                  value={slide.boxPadding ?? 36}
                  className="w-full"
                  style={{ accentColor: GREEN }}
                  onChange={(e) => updateSlide({ boxPadding: Number(e.target.value) })}
                />
              </label>
              <p style={{ fontSize: 10, color: "#ccc", lineHeight: 1.4, margin: 0 }}>
                Il box bianco si adatta alle scritte + questo margin.
              </p>
              {slide.boxLines.map((line, idx) => {
                const selected = selectedBoxLineId === line.id;
                return (
                  <div
                    key={line.id}
                    className="flex flex-col gap-1.5 p-2 rounded border"
                    style={{
                      borderColor: selected ? GREEN : "#e8e8ec",
                      background: selected ? "#f7fbf7" : "#fafafa",
                    }}
                    onClick={() => setSelectedBoxLineId(line.id)}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span style={{ fontSize: 10, color: "#aaa" }}>Riga {idx + 1}</span>
                      <div className="flex gap-0.5">
                        <button type="button" className="px-1.5 py-0.5 text-[10px] border rounded" style={{ borderColor: "#e4e4e8" }} onClick={(e) => { e.stopPropagation(); moveBoxLine(line.id, -1); }}>↑</button>
                        <button type="button" className="px-1.5 py-0.5 text-[10px] border rounded" style={{ borderColor: "#e4e4e8" }} onClick={(e) => { e.stopPropagation(); moveBoxLine(line.id, 1); }}>↓</button>
                        <button type="button" className="px-1.5 py-0.5 text-[10px] border rounded" style={{ borderColor: "#e4e4e8", color: "#c44" }} onClick={(e) => { e.stopPropagation(); removeBoxLine(line.id); }}>✕</button>
                      </div>
                    </div>
                    <input
                      className="w-full px-2 py-1 text-xs border rounded outline-none"
                      style={{ borderColor: "#e4e4e8" }}
                      value={line.text}
                      onChange={(e) => updateBoxLine(line.id, { text: e.target.value })}
                      placeholder="Testo riga"
                    />
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 10, color: "#888", width: 36 }}>Size</span>
                      <input
                        type="range" min={12} max={120} step={1}
                        value={line.size} className="flex-1" style={{ accentColor: GREEN }}
                        onChange={(e) => updateBoxLine(line.id, { size: Number(e.target.value) })}
                      />
                      <span className="font-mono w-8 text-right" style={{ fontSize: 10, color: "#666" }}>{line.size}</span>
                    </div>
                    <div className="flex gap-1">
                      {([400, 600, 700] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          className="flex-1 px-1 py-1 rounded text-[10px] border"
                          style={
                            line.weight === w
                              ? { background: "#edf7ee", borderColor: GREEN, color: GREEN, fontWeight: w }
                              : { borderColor: "#e4e4e8", color: "#666", fontWeight: w }
                          }
                          onClick={() => updateBoxLine(line.id, { weight: w })}
                        >
                          {w === 400 ? "Regular" : w === 600 ? "Semi" : "Bold"}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {(["left", "center", "right"] as TextAlign[]).map((align) => (
                        <button
                          key={align}
                          type="button"
                          className="flex-1 px-1 py-1 rounded text-[10px] border"
                          style={
                            line.align === align
                              ? { background: "#edf7ee", borderColor: GREEN, color: GREEN }
                              : { borderColor: "#e4e4e8", color: "#666" }
                          }
                          onClick={() => updateBoxLine(line.id, { align })}
                        >
                          {align === "left" ? "Sx" : align === "center" ? "Centro" : "Dx"}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-0.5">
                        <span style={{ fontSize: 10, color: "#aaa" }}>Colore</span>
                        <input
                          type="color"
                          value={/^#[0-9a-fA-F]{6}$/.test(line.color) ? line.color : GREEN}
                          className="w-full h-7 border rounded cursor-pointer"
                          style={{ borderColor: "#e4e4e8", padding: 2 }}
                          onChange={(e) => updateBoxLine(line.id, { color: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span style={{ fontSize: 10, color: "#aaa" }}>Tracking</span>
                        <input
                          type="number"
                          className="w-full px-2 py-1 text-xs border rounded font-mono outline-none"
                          style={{ borderColor: "#e4e4e8" }}
                          value={line.letterSpacing}
                          onChange={(e) => updateBoxLine(line.id, { letterSpacing: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-0.5">
                      <div className="flex justify-between">
                        <span style={{ fontSize: 10, color: "#888" }}>Offset Y</span>
                        <span className="font-mono" style={{ fontSize: 10, color: "#666" }}>{line.offsetY}px</span>
                      </div>
                      <input
                        type="range" min={-40} max={40} step={1}
                        value={line.offsetY} className="w-full" style={{ accentColor: GREEN }}
                        onChange={(e) => updateBoxLine(line.id, { offsetY: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                );
              })}
              <button
                type="button"
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded border text-xs"
                style={{ borderColor: "#e2e2e6", color: "#555" }}
                onClick={addBoxLine}
              >
                <Plus size={11} /> Aggiungi riga
              </button>
            </div>
          )}
        </Section>

        <Section label="Immagini" accent="#e0e4f8" accentText="#5f6598">
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
          <p style={{ fontSize: 10, color: "#bbb", margin: 0, lineHeight: 1.45 }}>
            Oppure incolla dagli appunti (Ctrl/⌘V) e scegli foto o logo.
          </p>
          {(slide.bg || slide.logo) && (
            <button className="flex items-center gap-1.5 text-xs hover:opacity-60 transition-opacity" style={{ color: "#c0c0c4" }} onClick={resetPos}>
              <RefreshCcw size={11} /> Reset posizioni
            </button>
          )}
        </Section>
        </div>

        <div className="p-4 shrink-0 flex flex-col gap-2" style={{ borderTop: "1px solid #f2f2f4", background: "white" }}>
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
            <Download size={12} /> Esporta tutte (ZIP)
          </button>
        </div>
      </div>

      {compact && (
        <nav
          className="fixed left-0 right-0 z-[55] grid grid-cols-3"
          style={{
            bottom: 0,
            height: `calc(${MOBILE_NAV_H} + env(safe-area-inset-bottom, 0px))`,
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            background: "white",
            borderTop: "1px solid #e6e6ea",
            boxShadow: "0 -8px 24px rgba(0,0,0,0.06)",
          }}
        >
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
            style={{ color: slidesOpen ? GREEN : "#666" }}
            onClick={toggleSlides}
          >
            <Layers size={18} />
            Slide
          </button>
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold disabled:opacity-50"
            style={{ color: GREEN }}
            disabled={exporting}
            onClick={() => { closePanels(); handleExport(); }}
          >
            <Download size={18} />
            {exporting ? "…" : "JPEG"}
          </button>
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
            style={{ color: editorOpen ? GREEN : "#666" }}
            onClick={toggleEditor}
          >
            <SlidersHorizontal size={18} />
            Editor
          </button>
        </nav>
      )}

      {pasteImage && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={closePasteImage}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "white", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") closePasteImage(); }}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #eee" }}>
              <div className="text-sm font-bold" style={{ color: "#222" }}>Incolla immagine</div>
              <button type="button" onClick={closePasteImage} style={{ color: "#999" }} aria-label="Chiudi">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div
                className="w-full rounded-xl overflow-hidden flex items-center justify-center"
                style={{ background: "#f3f3f5", maxHeight: 220 }}
              >
                <img
                  src={pasteImage.preview}
                  alt="Immagine dagli appunti"
                  className="max-w-full max-h-[220px] object-contain"
                />
              </div>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-bold text-white"
                style={{ background: GREEN }}
                onClick={() => applyPastedImage("bg")}
              >
                <ImageIcon size={16} />
                Inserisci come foto
              </button>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-semibold border"
                style={{ borderColor: "#e2e2e6", color: "#444" }}
                onClick={() => applyPastedImage("logo")}
              >
                <Upload size={16} />
                Inserisci come logo
              </button>
            </div>
          </div>
        </div>
      )}

      {saveModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={() => setSaveModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "white", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #eee" }}>
              <div className="text-sm font-bold" style={{ color: "#222" }}>Salva progetto .pscnl</div>
              <button type="button" onClick={() => setSaveModalOpen(false)} style={{ color: "#999" }} aria-label="Chiudi">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span style={{ fontSize: 11, color: "#888" }}>Data della newsletter</span>
                <input
                  type="date"
                  className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                  style={{ borderColor: "#e4e4e8" }}
                  value={saveDateDraft}
                  onChange={(e) => setSaveDateDraft(e.target.value)}
                  autoFocus
                />
              </label>
              <p style={{ fontSize: 11, color: "#999", margin: 0, lineHeight: 1.45 }}>
                Il file si chiamerà{" "}
                <span style={{ fontFamily: "ui-monospace, monospace", color: "#555" }}>
                  {projectFileName(saveDateDraft)}
                </span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 py-3" style={{ borderTop: "1px solid #eee" }}>
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-semibold border"
                style={{ borderColor: "#e4e4e8", color: "#666" }}
                onClick={() => setSaveModalOpen(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-bold text-white"
                style={{ background: GREEN }}
                onClick={confirmSaveProject}
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

      {falModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "white", maxHeight: "92dvh", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #eee" }}>
              <div className="text-sm font-bold" style={{ color: "#222" }}>Anteprima generazione</div>
              <button type="button" onClick={handleFalAnnulla} style={{ color: "#999" }} aria-label="Chiudi">
                <X size={18} />
              </button>
            </div>
            <div className="relative flex-1 overflow-auto p-4 flex flex-col gap-3 min-h-0">
              <div
                className="relative w-full rounded-xl overflow-hidden"
                style={{ background: "#f3f3f5", aspectRatio: "1 / 1", maxHeight: "52vh" }}
              >
                {falResultUrl && (
                  <img
                    src={falResultUrl}
                    alt="Risultato Fal"
                    className="w-full h-full object-contain"
                    style={{ filter: falGenerating ? "blur(2px) saturate(0.6)" : undefined }}
                  />
                )}
                {falGenerating && (
                  <div className="fal-generating-overlay" style={{ borderRadius: 12 }}>
                    <div className="fal-generating-label">{falStatus || "Generazione in corso…"}</div>
                  </div>
                )}
                {!falGenerating && !falResultUrl && !falError && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: "#aaa" }}>
                    Nessuna anteprima
                  </div>
                )}
              </div>
              <label className="flex flex-col gap-1">
                <span style={{ fontSize: 11, color: "#aaa" }}>Prompt</span>
                <input
                  type="text"
                  className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                  style={{ borderColor: "#e4e4e8" }}
                  value={falPrompt}
                  onChange={(e) => setFalPrompt(e.target.value)}
                  disabled={falGenerating}
                  placeholder="Descrivi il prodotto in breve…"
                />
              </label>
              {falError && (
                <p style={{ fontSize: 12, color: "#c0392b", margin: 0, lineHeight: 1.4 }}>{falError}</p>
              )}
            </div>
            <div
              className="grid grid-cols-2 gap-2 px-4 py-3"
              style={{ borderTop: "1px solid #eee" }}
            >
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-semibold border"
                style={{ borderColor: "#e4e4e8", color: "#666" }}
                onClick={handleFalAnnulla}
                disabled={falGenerating}
              >
                Annulla
              </button>
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5"
                style={{ borderColor: "#e4e4e8", color: "#555" }}
                onClick={handleFalRipeti}
                disabled={falGenerating}
              >
                <RefreshCcw size={12} /> Ripeti
              </button>
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5"
                style={{ borderColor: "#e4e4e8", color: "#555" }}
                onClick={handleFalScarica}
                disabled={falGenerating || !falResultUrl}
              >
                <Download size={12} /> Scarica
              </button>
              <button
                type="button"
                className="px-3 py-2.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                style={{ background: GREEN }}
                onClick={handleFalSostituisci}
                disabled={falGenerating || !falResultUrl}
              >
                Sostituisci
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar helpers ──────────────────────────────────────────────────────────

function Section({
  label,
  children,
  defaultOpen = false,
  accent = "#f0f0f2",
  accentText = "#888890",
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  accent?: string;
  accentText?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #f2f2f4" }}>
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left"
        style={{ background: accent }}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="inline-flex items-center gap-2"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.11em", color: accentText, textTransform: "uppercase" }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: accentText,
              opacity: 0.55,
              flexShrink: 0,
            }}
          />
          {label}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: accentText,
            opacity: 0.7,
            flexShrink: 0,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 flex flex-col gap-3">
          {children}
        </div>
      )}
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
