import { createWorker } from 'tesseract.js';
import { TabBar, TabColumn, TabNote, Articulation, newId } from '../models/tab';
import { DEFAULT_TIME_SIG, NoteLength } from '../models/playback';

// ── Public types ───────────────────────────────────────────────────────────

export interface OcrProgress {
  status:   string;
  progress: number; // 0–1
}

/** A single word/token recognised by Tesseract with its image coordinates. */
export interface OcrWordBox {
  text: string;
  x:    number; // centre X in (pre-processed) image pixels
  y:    number; // centre Y
  x0:   number; // left edge
  x1:   number; // right edge
}

/**
 * Everything returned from one OCR run:
 *  - `words`               → bounding-box data used by the spatial parser
 *  - `rawText`             → shown in the review modal as a plain-text fallback
 *  - `staffLines`          → Y positions of each string line detected from pixels
 *                            (top = highest string; populated by detectStringCountAndLines)
 *  - `detectedStringCount` → auto-detected string count (6, 7, or 8); null = unknown
 */
export interface OcrResult {
  words:               OcrWordBox[];
  rawText:             string;
  staffLines:          number[];
  detectedStringCount: 6 | 7 | 8 | null;
  /** Per-column note lengths detected from stems/beams above the staff.
   *  Empty when staff lines were not found or the image lacks stem notation. */
  columnNoteLengths:   Array<{ x: number; length: NoteLength }>;
}

// ── Image pre-processing ───────────────────────────────────────────────────

/**
 * Converts an image file to a high-contrast black-on-white PNG blob that
 * Tesseract can read reliably.
 *
 * • Handles dark-background images (e.g. Guitar Pro dark theme) by detecting
 *   average brightness and inverting when needed.
 * • Upscales images whose long side is shorter than 2 000 px so that small
 *   fret digits (especially "0") are not silently dropped by OCR.
 */
export function preprocessImageForOcr(file: File): Promise<Blob> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve(file); return; }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d  = id.data;

        // Detect dark vs light background by average brightness
        let totalGray = 0;
        for (let i = 0; i < d.length; i += 4)
          totalGray += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const avgGray = totalGray / (d.length / 4);
        const darkBg  = avgGray < 128;
        const thresh  = darkBg ? 100 : 160;

        // Threshold → B&W; invert if dark background so output = black-on-white
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = darkBg ? (g > thresh ? 0 : 255) : (g > thresh ? 255 : 0);
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(id, 0, 0);

        // Upscale if the long side < 2 000 px
        const MIN_LONG = 2000;
        const long  = Math.max(canvas.width, canvas.height);
        let out = canvas;
        if (long < MIN_LONG) {
          const s = MIN_LONG / long;
          const sc = document.createElement('canvas');
          sc.width  = Math.round(canvas.width  * s);
          sc.height = Math.round(canvas.height * s);
          const sctx = sc.getContext('2d');
          if (sctx) { sctx.imageSmoothingEnabled = false; sctx.drawImage(canvas, 0, 0, sc.width, sc.height); out = sc; }
        }

        out.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob ?? file); }, 'image/png');
      } catch { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── OCR ────────────────────────────────────────────────────────────────────

/**
 * Character whitelist for tab OCR.
 *
 * Covers:
 *  - Fret numbers: 0–9
 *  - Muted string: x X
 *  - Hammer-on: h  |  Pull-off: p  |  Bend suffix: b
 *  - Palm mute label: P M .
 *  - Slide up/down: / \
 *  - Vibrato: ~
 *  - Harmonic brackets: < >
 *  - Paren/bracket notation: ( )
 *  - PM span dashes: -
 *
 * Restricting to this set dramatically reduces noise on non-text graphical
 * elements while retaining every musically significant character.
 */
const TAB_OCR_WHITELIST = '0123456789xXhpbPM./\\~<>()-';

/**
 * Runs Tesseract (PSM 11 — sparse text, LSTM engine) on the pre-processed blob.
 * Returns both the raw text string and per-word bounding boxes.
 */
export async function ocrImage(
  source: File | Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await createWorker({
    logger: (m: any) => {
      if (onProgress && typeof m.progress === 'number')
        onProgress({ status: String(m.status ?? ''), progress: m.progress });
    },
  });
  try {
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_pageseg_mode:   '11' as any, // sparse text — numbers scattered between lines
      tessedit_char_whitelist: TAB_OCR_WHITELIST,
    });
    const { data } = await worker.recognize(source);

    const words: OcrWordBox[] = (data.words ?? [])
      .filter((w: any) => String(w.text ?? '').trim().length > 0)
      .map((w: any) => ({
        text: String(w.text ?? '').trim(),
        x:   (w.bbox.x0 + w.bbox.x1) / 2,
        y:   (w.bbox.y0 + w.bbox.y1) / 2,
        x0:  w.bbox.x0,
        x1:  w.bbox.x1,
      }));

    return { words, rawText: data.text ?? '', staffLines: [], detectedStringCount: null, columnNoteLengths: [] };
  } finally {
    await worker.terminate();
  }
}

// ── Pixel-based staff-line detection ──────────────────────────────────────

/**
 * Scan the left 8 % margin of a black-on-white image and return the Y centre
 * of every continuous horizontal dark band.  This is the shared pixel kernel
 * used by both `detectStringCountAndLines` and `detectStaffLines`.
 */
function detectAllHorizontalLines(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
): number[] {
  const mw = Math.max(2, Math.floor(width * 0.08));
  const candidate: boolean[] = new Array(height).fill(false);

  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < mw; x++) {
      if (data[(y * width + x) * 4] < 128) dark++;
    }
    candidate[y] = dark / mw >= 0.5;
  }

  const centers: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    if (y < height && candidate[y]) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      centers.push(Math.round((start + y - 1) / 2));
      start = -1;
    }
  }
  return centers;
}

/**
 * Find the window of `count` consecutive lines from `allLines` whose
 * inter-line spacings are most uniform (lowest coefficient of variation).
 */
function bestWindowForCount(
  allLines: number[],
  count:    number,
): { lines: number[]; cv: number } | null {
  if (allLines.length < count) return null;
  let best: { lines: number[]; cv: number } | null = null;

  for (let i = 0; i <= allLines.length - count; i++) {
    const win  = allLines.slice(i, i + count);
    const gaps = win.slice(1).map((y, j) => y - win[j]);
    if (gaps.some(g => g <= 0)) continue;
    const mean = gaps.reduce((a, b) => a + b) / gaps.length;
    if (mean <= 0) continue;
    const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    if (!best || cv < best.cv) best = { lines: win, cv };
  }
  return best;
}

/**
 * Given all detected line centers, determine whether the tab has 6, 7, or 8
 * strings by finding whichever count gives the most evenly-spaced window.
 * Ties are broken in favour of fewer strings (6 > 7 > 8) since 6-string is
 * by far the most common.
 */
function autoFitStringCount(
  allLines: number[],
): { count: 6 | 7 | 8; lines: number[] } | null {
  const results: Array<{ count: 6 | 7 | 8; lines: number[]; cv: number }> = [];

  for (const count of [6, 7, 8] as const) {
    const fit = bestWindowForCount(allLines, count);
    if (fit) results.push({ count, lines: fit.lines, cv: fit.cv });
  }
  if (results.length === 0) return null;

  // Sort by cv ascending; break ties by preferring lower string counts
  results.sort((a, b) => a.cv !== b.cv ? a.cv - b.cv : a.count - b.count);
  return { count: results[0].count, lines: results[0].lines };
}

// ── Public: string-count detection ────────────────────────────────────────

/**
 * Auto-detects the number of guitar strings (6, 7, or 8) from the image and
 * returns the corresponding staff-line Y positions (top = highest string).
 *
 * The result is used in place of the manual `numStrings` setting when importing
 * a tab image.  Falls back to `{ count: null, lines: [] }` when fewer than 6
 * evenly-spaced lines can be found.
 */
export function detectStringCountAndLines(
  blob: Blob,
): Promise<{ count: 6 | 7 | 8 | null; lines: number[] }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c   = document.createElement('canvas');
        c.width   = img.naturalWidth;
        c.height  = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve({ count: null, lines: [] }); return; }
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        URL.revokeObjectURL(url);

        const allLines = detectAllHorizontalLines(data, width, height);
        const fit      = autoFitStringCount(allLines);
        resolve(fit ?? { count: null, lines: allLines });
      } catch {
        URL.revokeObjectURL(url);
        resolve({ count: null, lines: [] });
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ count: null, lines: [] }); };
    img.src = url;
  });
}

/**
 * Backward-compatible wrapper used by the existing OCR modal flow when an
 * explicit string count is already known.  Returns staff-line Y positions for
 * exactly `numStrings` strings (selects the most evenly-spaced window).
 */
export function detectStaffLines(blob: Blob, numStrings: number): Promise<number[]> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c   = document.createElement('canvas');
        c.width   = img.naturalWidth;
        c.height  = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve([]); return; }
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        URL.revokeObjectURL(url);

        const allLines = detectAllHorizontalLines(data, width, height);
        if (allLines.length < numStrings) { resolve(allLines); return; }
        const fit = bestWindowForCount(allLines, numStrings);
        resolve(fit ? fit.lines : pickEvenlySpaced(allLines, numStrings));
      } catch {
        URL.revokeObjectURL(url);
        resolve([]);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve([]); };
    img.src = url;
  });
}

/** Select the `n` lines from `sorted` whose inter-line spacings have the
 *  lowest variance (= most evenly spaced = the tab staff). */
function pickEvenlySpaced(sorted: number[], n: number): number[] {
  if (sorted.length <= n) return sorted;
  let best = sorted.slice(0, n);
  let bestVar = Infinity;
  for (let i = 0; i <= sorted.length - n; i++) {
    const win = sorted.slice(i, i + n);
    const gaps = win.slice(1).map((y, j) => y - win[j]);
    const mean = gaps.reduce((a, b) => a + b) / gaps.length;
    const v    = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
    if (v < bestVar) { bestVar = v; best = win; }
  }
  return best;
}

// ── Spatial tab parser ─────────────────────────────────────────────────────

interface FretWord extends OcrWordBox {
  fretVal: number | 'x';
}

/**
 * Try to parse a raw OCR token as a fret value (0–24) or muted marker.
 * Also handles "7b"-style bend-suffix tokens (extracts the fret number).
 */
function parseFretToken(text: string): number | 'x' | null {
  const t = text.replace(/[()[\]]/g, '').trim();
  if (t === 'x' || t === 'X') return 'x';
  // "7b" → fret 7 (bend notation — we record the fret; bend amount needs manual entry)
  const withBend = t.match(/^(\d+)b$/);
  if (withBend) {
    const n = parseInt(withBend[1], 10);
    return n >= 0 && n <= 24 ? n : null;
  }
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n >= 0 && n <= 24 ? n : null;
}

/** Cluster items by Y coordinate, returning clusters sorted top-to-bottom. */
function clusterByY(items: FretWord[], tolerance: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const clusters: Array<{ centerY: number; items: FretWord[] }> = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && item.y - last.centerY <= tolerance) {
      last.items.push(item);
      last.centerY = last.items.reduce((s, i) => s + i.y, 0) / last.items.length;
    } else {
      clusters.push({ centerY: item.y, items: [item] });
    }
  }
  return clusters;
}

/**
 * Find the set of Y-clusters that best represent `numStrings` guitar strings.
 */
function findStringClusters(words: FretWord[], numStrings: number) {
  for (const tol of [4, 8, 14, 20, 30, 50, 80]) {
    const cls = clusterByY(words, tol);
    if (cls.length <= numStrings) return cls.sort((a, b) => a.centerY - b.centerY);
  }
  return clusterByY(words, 80)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, numStrings)
    .sort((a, b) => a.centerY - b.centerY);
}

/** Extended note position — carries markup annotations determined after OCR. */
interface NoteWithPos {
  stringIdx:    number;
  fret:         number | 'x';
  x:            number;
  y:            number;
  articulation?: Articulation;
  vibrato?:     boolean;
  harmonic?:    boolean;
  palmMuted?:   boolean;
}

/** Group notes into columns by X position using an adaptive tolerance. */
function groupIntoColumns(notes: NoteWithPos[]): NoteWithPos[][] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.x - b.x);

  const singleString = sorted.filter(n => n.stringIdx === sorted[0].stringIdx);
  const gaps = singleString.slice(1).map((n, i) => n.x - singleString[i].x).filter(g => g > 1);
  const medGap = gaps.length
    ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 20;
  const xTol = Math.max(medGap * 0.35, 6);

  const columns: NoteWithPos[][] = [];
  for (const note of sorted) {
    const last  = columns[columns.length - 1];
    const lastX = last ? last.reduce((s, n) => s + n.x, 0) / last.length : -Infinity;
    if (last && note.x - lastX <= xTol) {
      last.push(note);
    } else {
      columns.push([note]);
    }
  }
  return columns;
}

/** Split an ordered list of columns into bars at large X gaps. */
function splitColumnsIntoBars(columns: NoteWithPos[][]): NoteWithPos[][][] {
  if (columns.length === 0) return [];

  const centerXs = columns.map(c => c.reduce((s, n) => s + n.x, 0) / c.length);
  const gaps     = centerXs.slice(1).map((x, i) => x - centerXs[i]);
  const medGap   = gaps.length
    ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 0;
  const barThresh = medGap * 2.5;

  const bars: NoteWithPos[][][] = [];
  let cur: NoteWithPos[][] = [];
  for (let i = 0; i < columns.length; i++) {
    cur.push(columns[i]);
    const isLast = i === columns.length - 1;
    const bigGap = !isLast && barThresh > 0 && (centerXs[i + 1] - centerXs[i]) > barThresh;
    if (isLast || bigGap) { bars.push(cur); cur = []; }
  }
  return bars;
}

// ── Markup extraction (articulations, vibrato, harmonics, P.M.) ──────────

interface ArtToken {
  /** Connector type — 'vibrato', 'harmonic-open', or 'harmonic-close' are note
   *  decorators; the rest are connecting articulations between two notes. */
  type: Articulation | 'vibrato' | 'harmonic-open' | 'harmonic-close';
  x:   number;
  y:   number;
}

/** A P.M. span: left edge (x0) and right edge (x1) in image pixels. */
interface PMSpan {
  x0: number;
  x1: number;
}

/**
 * Classify the OCR word list into articulation tokens and P.M. spans.
 *
 * Articulation connectors (h, p, /, \) sit between two consecutive fret
 * numbers on the same string.  Decorator tokens (~, <, >) are adjacent to
 * a single note.  "P.M." tokens mark palm-muted regions.
 */
function extractMarkupTokens(words: OcrWordBox[]): {
  artTokens: ArtToken[];
  pmSpans:   PMSpan[];
} {
  const artTokens: ArtToken[] = [];
  const pmCandidates: OcrWordBox[] = [];

  for (const w of words) {
    switch (w.text) {
      case 'h':  artTokens.push({ type: 'hammer',         x: w.x, y: w.y }); break;
      case 'p':  artTokens.push({ type: 'pulloff',        x: w.x, y: w.y }); break;
      case '/':  artTokens.push({ type: 'slide-up',       x: w.x, y: w.y }); break;
      case '\\': artTokens.push({ type: 'slide-down',     x: w.x, y: w.y }); break;
      case '~':  artTokens.push({ type: 'vibrato',        x: w.x, y: w.y }); break;
      case '<':  artTokens.push({ type: 'harmonic-open',  x: w.x, y: w.y }); break;
      case '>':  artTokens.push({ type: 'harmonic-close', x: w.x, y: w.y }); break;
      default:   break;
    }
    // P.M. detection: "PM", "P.M.", "P.M", "pm", etc.
    if (/^[Pp]\.?[Mm]\.?$/.test(w.text)) pmCandidates.push(w);
  }

  // Build PM spans — extend rightward over consecutive dash tokens
  const pmSpans: PMSpan[] = pmCandidates.map(pm => {
    let spanEnd = pm.x1;
    const rightDashes = words
      .filter(w =>
        w.x0 > pm.x1 - 5 &&
        w.x0 < pm.x1 + 500 &&
        Math.abs(w.y - pm.y) < 20 &&
        /^[-—–_]+$/.test(w.text),
      )
      .sort((a, b) => a.x0 - b.x0);

    for (const d of rightDashes) {
      if (d.x0 <= spanEnd + 15) spanEnd = Math.max(spanEnd, d.x1);
      else break;
    }
    return { x0: pm.x0, x1: spanEnd };
  });

  return { artTokens, pmSpans };
}

/**
 * Walk each string's notes left-to-right and assign articulation connectors,
 * vibrato decorators, and harmonic brackets based on spatial proximity.
 *
 * `lineSpacing` is the average Y distance between adjacent staff lines and
 * is used to set the Y-band tolerance for token–note matching.
 */
function applyArticulations(
  notes:      NoteWithPos[],
  artTokens:  ArtToken[],
  lineSpacing: number,
): void {
  const yTol = Math.max(lineSpacing * 0.45, 8);

  // Group by string, process pairs
  const byString = new Map<number, NoteWithPos[]>();
  for (const n of notes) {
    if (!byString.has(n.stringIdx)) byString.set(n.stringIdx, []);
    byString.get(n.stringIdx)!.push(n);
  }

  for (const strNotes of Array.from(byString.values())) {
    strNotes.sort((a, b) => a.x - b.x);

    for (let i = 0; i < strNotes.length; i++) {
      const note = strNotes[i];
      const prev = strNotes[i - 1];

      for (const tok of artTokens) {
        if (Math.abs(tok.y - note.y) > yTol) continue;

        if (tok.type === 'vibrato') {
          // Vibrato token appears immediately after the note it decorates
          if (tok.x > note.x && tok.x < note.x + 50) note.vibrato = true;
        } else if (tok.type !== 'harmonic-open' && tok.type !== 'harmonic-close') {
          // Connector: token must be between the previous note and this one
          if (prev && tok.x > prev.x && tok.x < note.x) {
            note.articulation = tok.type as Articulation;
          }
        }
      }
    }
  }

  // Harmonics: note is enclosed between a '<' to its left and a '>' to its right
  const opens  = artTokens.filter(t => t.type === 'harmonic-open');
  const closes = artTokens.filter(t => t.type === 'harmonic-close');
  for (const note of notes) {
    const hasOpen  = opens.some(o => o.x < note.x && Math.abs(o.y - note.y) < yTol);
    const hasClose = closes.some(c => c.x > note.x && Math.abs(c.y - note.y) < yTol);
    if (hasOpen && hasClose) note.harmonic = true;
  }
}

/**
 * Mark all notes whose X falls within a P.M. span.
 * The span extends rightward from the "P.M." text until a bar-break gap is
 * encountered, using the median note-spacing to calibrate "large gap".
 */
function applyPalmMuting(notes: NoteWithPos[], pmSpans: PMSpan[]): void {
  if (pmSpans.length === 0) return;

  // Calibrate bar-break threshold from median inter-note X gap
  const allXsSorted = Array.from(new Set(notes.map(n => n.x))).sort((a, b) => a - b);
  const xGaps = allXsSorted.slice(1).map((x, i) => x - allXsSorted[i]);
  const medXGap = xGaps.length
    ? [...xGaps].sort((a, b) => a - b)[Math.floor(xGaps.length / 2)]
    : 20;
  const barBreakThresh = medXGap * 3;

  for (const span of pmSpans) {
    // If the span's right edge was not extended by dashes, push it forward
    // until we hit a bar-break (ensures isolated P.M. marks cover their beat).
    let effectiveEnd = span.x1;
    let prevX = span.x0;
    for (const x of allXsSorted.filter(x => x >= span.x0)) {
      if (x - prevX > barBreakThresh) break;
      effectiveEnd = Math.max(effectiveEnd, x);
      prevX = x;
    }

    for (const n of notes) {
      if (n.x >= span.x0 && n.x <= effectiveEnd + medXGap) {
        n.palmMuted = true;
      }
    }
  }
}

// ── Note-length detection from stems and beams ────────────────────────────
//
// Standard guitar tab notation places music stems (and beams for 8th/16th notes)
// ABOVE the tab staff.  This section detects those pixel patterns to assign
// accurate NoteLength values to each note column.
//
// Algorithm per column X:
//   1. Narrow vertical scan  → is a stem present?  (no = whole note)
//   2. Wide horizontal scan  → how many beam bands cross the stem?
//        0 beams → quarter   1 → eighth   2 → sixteenth   3 → thirtysecond
//
// After per-column detection a proportional-spacing pass upgrades candidate
// quarter notes to half notes when the gap to the next column is ≥ 1.8× median.

/**
 * Analyse a single column's stem region (above the tab staff) and return
 * the most likely NoteLength.
 */
function analyzeNoteLength(
  data:          Uint8ClampedArray,
  imgWidth:      number,
  imgHeight:     number,
  centerX:       number,
  staffBottomY:  number,   // Y of the LOWEST staff line — stems hang downward from here
  lineSpacing:   number,
): NoteLength {
  // Rhythm notation is BELOW the bottom staff line in Guitar Pro / standard tab exports.
  // Bends appear ABOVE / between the string lines and are completely outside this region.
  //
  // Start just past the bottom line; scan ~4.5 line-spacings downward.
  const scanTop = Math.min(imgHeight - 2, staffBottomY + Math.round(lineSpacing * 0.2));
  const scanBot = Math.min(imgHeight,     staffBottomY + Math.round(lineSpacing * 4.5));

  if (scanBot <= scanTop + 4) return 'quarter'; // not enough image below the staff

  // ── Step 1: stem presence ─────────────────────────────────────────────────
  // Scan 5 individual pixel columns (centerX ± 2) and keep the one with the
  // most dark pixels.  This avoids the density-dilution problem that occurs
  // when averaging across a wide band: a 1-px stem in an 11-px band gives only
  // ~9 % density (below a 12 % threshold), which wrongly returns 'whole'.
  // By taking the per-column maximum we get ~100 % coverage for any real stem
  // regardless of its exact sub-pixel position relative to centerX.
  const stemScanH = scanBot - scanTop;
  let maxStemDark = 0;
  for (let dx = -2; dx <= 2; dx++) {
    const px = centerX + dx;
    if (px < 0 || px >= imgWidth) continue;
    let dark = 0;
    for (let y = scanTop; y < scanBot; y++) {
      if (data[(y * imgWidth + px) * 4] < 128) dark++;
    }
    if (dark > maxStemDark) maxStemDark = dark;
  }
  // Require at least 20 % of the scan height in the best single column.
  // A full stem fills ~100 %; a horizontal beam alone adds ≤ 5 px per column.
  if (maxStemDark < stemScanH * 0.20) return 'whole';

  // ── Step 2: beam counting (wide horizontal scan) ──────────────────────────
  // Beams are thick horizontal bars spanning many columns.
  // In a wide horizontal scan they register as dense rows;
  // lone stems contribute very little density (thin vertical lines only).
  const beamHalfW = Math.round(lineSpacing * 1.8);
  const bxLeft    = Math.max(0, centerX - beamHalfW);
  const bxRight   = Math.min(imgWidth - 1, centerX + beamHalfW);
  const bWidth    = bxRight - bxLeft + 1;
  if (bWidth <= 0) return 'quarter';

  const rowDensity: number[] = [];
  for (let y = scanTop; y < scanBot; y++) {
    let dark = 0;
    for (let x = bxLeft; x <= bxRight; x++) {
      if (data[(y * imgWidth + x) * 4] < 128) dark++;
    }
    rowDensity.push(dark / bWidth);
  }

  // A beam spanning the full band ≈ density 1.0; a lone stem ≈ 2–5 %.
  // Threshold 18 % reliably separates beams from single stems.
  const beamThresh = 0.18;
  let beamCount = 0;
  let inBeam    = false;
  for (const d of rowDensity) {
    if (d >= beamThresh) {
      if (!inBeam) { beamCount++; inBeam = true; }
    } else if (d < beamThresh * 0.5) {
      inBeam = false;
    }
  }

  if (beamCount === 0) return 'quarter'; // stem, no beams → quarter (or half — see below)
  if (beamCount === 1) return 'eighth';
  if (beamCount === 2) return 'sixteenth';
  return 'thirtysecond';
}

/**
 * Deduplicate a list of X positions within a small pixel tolerance.
 * Used to turn per-word X values into per-column X values.
 */
function deduplicateXPositions(xs: number[], tol: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const result: number[] = [];
  for (const x of sorted) {
    if (result.length === 0 || x - result[result.length - 1] > tol) {
      result.push(x);
    }
  }
  return result;
}

/**
 * Detect note lengths (whole / quarter / eighth / sixteenth / thirtysecond)
 * for every note column found in the OCR word list.
 *
 * A secondary proportional-spacing pass upgrades candidate quarter notes to
 * half notes when the X gap to the next column is ≥ 1.8 × the median gap —
 * this catches half notes whose hollow noteheads are hard to distinguish from
 * quarter noteheads in the stem-only analysis.
 *
 * @param blob       — The pre-processed (B&W) blob used for OCR.
 * @param words      — OCR word boxes (only fret-token positions are used).
 * @param staffLines — Y positions of the detected staff lines (top → bottom).
 */
export function detectColumnNoteLengths(
  blob:       Blob,
  words:      OcrWordBox[],
  staffLines: number[],
): Promise<Array<{ x: number; length: NoteLength }>> {
  if (staffLines.length < 2) return Promise.resolve([]);

  const columnXs = deduplicateXPositions(
    words.filter(w => parseFretToken(w.text) !== null).map(w => w.x),
    10,
  );
  if (columnXs.length === 0) return Promise.resolve([]);

  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c   = document.createElement('canvas');
        c.width   = img.naturalWidth;
        c.height  = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve([]); return; }
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        URL.revokeObjectURL(url);

        // Rhythm stems hang DOWNWARD from the bottom staff line
        const staffBottomY = staffLines[staffLines.length - 1];
        const lineSpacing  = (staffLines[staffLines.length - 1] - staffLines[0]) /
                             (staffLines.length - 1);

        // Per-column pixel analysis
        const raw = columnXs.map(x => ({
          x,
          length: analyzeNoteLength(data, width, height, x, staffBottomY, lineSpacing),
        }));

        // Proportional-spacing pass: upgrade quarter → half when the gap to
        // the next column is ≥ 1.8× the median inter-column gap.
        if (raw.length >= 2) {
          const gaps = raw.slice(1).map((c, i) => c.x - raw[i].x).filter(g => g > 0);
          const sortedGaps = [...gaps].sort((a, b) => a - b);
          const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 1;

          for (let i = 0; i < raw.length; i++) {
            if (raw[i].length !== 'quarter') continue;
            const gap = i < raw.length - 1 ? raw[i + 1].x - raw[i].x : medGap;
            if (gap >= medGap * 1.8) raw[i] = { x: raw[i].x, length: 'half' };
          }
        }

        resolve(raw);
      } catch {
        URL.revokeObjectURL(url);
        resolve([]);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve([]); };
    img.src = url;
  });
}

// ── buildBarsFromOcrResult ─────────────────────────────────────────────────

/**
 * Build TabBar[] from an OcrResult by using the spatial position of each
 * detected digit rather than the text stream.  Applies articulations, vibrato,
 * harmonic, and palm-muting annotations extracted from the full word list.
 *
 * @param result     — Full OcrResult including bounding-box words + staff lines.
 * @param numStrings — Number of strings to use for mapping (typically
 *                     `result.detectedStringCount ?? tuning.length`).
 */
export function buildBarsFromOcrResult(result: OcrResult, numStrings: number): TabBar[] {
  // 1. Keep only words that look like valid fret values
  const fretWords: FretWord[] = result.words
    .map(w => ({ ...w, fretVal: parseFretToken(w.text) }))
    .filter((w): w is FretWord => w.fretVal !== null);

  if (fretWords.length === 0) return [];

  const allNotes: NoteWithPos[] = [];

  if (result.staffLines.length >= 1) {
    // ── Primary path: use pixel-detected staff lines ──────────────────────
    for (const w of fretWords) {
      let nearestIdx = 0, nearestDist = Infinity;
      for (let i = 0; i < result.staffLines.length; i++) {
        const d = Math.abs(w.y - result.staffLines[i]);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }
      const stringIdx = numStrings - 1 - nearestIdx;
      allNotes.push({ stringIdx, fret: w.fretVal, x: w.x, y: w.y });
    }
  } else {
    // ── Fallback: cluster by Y when pixel detection found no lines ────────
    const stringClusters = findStringClusters(fretWords, numStrings);
    if (stringClusters.length === 0) return [];
    stringClusters.forEach((cluster, ci) => {
      const stringIdx = numStrings - 1 - ci;
      cluster.items.forEach(item =>
        allNotes.push({ stringIdx, fret: item.fretVal, x: item.x, y: item.y })
      );
    });
  }

  // 2. Apply markup annotations (articulations, vibrato, harmonics, P.M.)
  const lineSpacing = result.staffLines.length >= 2
    ? (result.staffLines[result.staffLines.length - 1] - result.staffLines[0]) /
      (result.staffLines.length - 1)
    : 20;

  const { artTokens, pmSpans } = extractMarkupTokens(result.words);
  applyArticulations(allNotes, artTokens, lineSpacing);
  applyPalmMuting(allNotes, pmSpans);

  // 3. Group into columns (chords / simultaneous notes)
  const columns = groupIntoColumns(allNotes);
  if (columns.length === 0) return [];

  // 4. Split columns into bars at large X gaps (bar lines)
  const barGroups = splitColumnsIntoBars(columns);

  // 5. Build TabBar[]
  const nlMap = result.columnNoteLengths;

  return barGroups.map(group => {
    const tabColumns: TabColumn[] = group.map(colNotes => {
      const colX = colNotes.reduce((s, n) => s + n.x, 0) / colNotes.length;

      // Look up detected note length for this column (nearest X within 30 px)
      let noteLength: NoteLength = 'quarter';
      if (nlMap && nlMap.length > 0) {
        let bestDist = Infinity;
        for (const entry of nlMap) {
          const d = Math.abs(entry.x - colX);
          if (d < bestDist) { bestDist = d; noteLength = entry.length; }
        }
        if (bestDist > 30) noteLength = 'quarter'; // no close match
      }

      const notes: TabNote[] = colNotes.map(n => {
        const base: TabNote = n.fret === 'x'
          ? { stringIdx: n.stringIdx, fret: 0, muted: true }
          : { stringIdx: n.stringIdx, fret: n.fret as number };
        if (n.articulation) base.articulation = n.articulation;
        if (n.vibrato)      base.vibrato      = true;
        if (n.harmonic)     base.harmonic     = true;
        if (n.palmMuted)    base.palmMuted    = true;
        return base;
      });
      return { id: newId(), noteLength, notes };
    });
    return { id: newId(), timeSig: DEFAULT_TIME_SIG, columns: tabColumns };
  });
}

// ── ASCII / text-based tab parser (manual edit fallback) ───────────────────
//
// Used when the user edits the raw OCR text in the review modal.

const PREFIX_RE = /^\s*[eEbBgGdDaATt1-8]?\s*[|lI:]\s*/;

function fillerRatio(content: string): number {
  const fillers = (content.match(/[-\s]/g) ?? []).length;
  return content.length > 0 ? fillers / content.length : 0;
}

function isTabLine(line: string): boolean {
  const content = line.replace(PREFIX_RE, '').trimEnd();
  if (content.length < 8) return false;
  const digits  = (content.match(/\d/g)       ?? []).length;
  const letters = (content.match(/[a-zA-Z]/g) ?? []).length;
  const ratio   = fillerRatio(content);
  return (digits >= 1 && ratio >= 0.3) || (ratio >= 0.7 && letters <= 2);
}

function isActiveTabLine(line: string): boolean {
  const content = line.replace(PREFIX_RE, '').trimEnd();
  return /\d/.test(content) || /[xX]/.test(content);
}

function stripPrefix(line: string): string {
  return line.replace(PREFIX_RE, '');
}

interface FretEntry { pos: number; value: number | 'x'; }

function extractFrets(content: string): FretEntry[] {
  const entries: FretEntry[] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === 'x' || ch === 'X') {
      entries.push({ pos: i, value: 'x' }); i++;
    } else if (ch === '(' && /\d/.test(content[i + 1] ?? '')) {
      let j = i + 1;
      while (j < content.length && /\d/.test(content[j])) j++;
      const fret = parseInt(content.slice(i + 1, j), 10);
      if (fret <= 24) entries.push({ pos: i, value: fret });
      i = content[j] === ')' ? j + 1 : j;
    } else if (/\d/.test(ch)) {
      let j = i;
      while (j < content.length && /\d/.test(content[j])) j++;
      const fret = parseInt(content.slice(i, j), 10);
      if (fret <= 24) entries.push({ pos: i, value: fret });
      i = j;
    } else { i++; }
  }
  return entries;
}

function parseSection(stringContents: string[], numStrings: number): TabColumn[] {
  const stringFrets = stringContents.map(extractFrets);
  const allPos = new Set<number>();
  for (const sf of stringFrets) for (const f of sf) allPos.add(f.pos);
  if (allPos.size === 0) return [];

  const sorted = Array.from(allPos).sort((a, b) => a - b);
  const reps: number[] = [];
  let prev = -999;
  for (const pos of sorted) {
    if (pos - prev > 2) { reps.push(pos); prev = pos; } else prev = pos;
  }

  return reps.flatMap(rep => {
    const notes: TabNote[] = [];
    for (let li = 0; li < numStrings; li++) {
      const stringIdx = numStrings - 1 - li;
      const entry = stringFrets[li]?.find(f => Math.abs(f.pos - rep) <= 2);
      if (!entry) continue;
      notes.push(entry.value === 'x'
        ? { stringIdx, fret: 0, muted: true }
        : { stringIdx, fret: entry.value as number });
    }
    return notes.length > 0
      ? [{ id: newId(), noteLength: 'quarter' as const, notes }]
      : [];
  });
}

function findTabGroups(lines: string[], numStrings: number): string[][] {
  const groups: string[][] = [];
  let i = 0;
  while (i <= lines.length - numStrings) {
    const slice = lines.slice(i, i + numStrings);
    if (slice.every(isTabLine) && slice.some(isActiveTabLine)) {
      groups.push(slice.map(stripPrefix));
      i += numStrings;
    } else { i++; }
  }
  return groups;
}

function parseTabGroup(group: string[], numStrings: number): TabBar[] {
  const hasBars = group[0].includes('|');
  let sections: string[][];
  if (hasBars) {
    const split = group.map(c => c.split('|').map(s => s.trim()).filter(s => /\d/.test(s)));
    const n = Math.min(...split.map(s => s.length));
    sections = n > 0
      ? Array.from({ length: n }, (_, bi) => split.map(sc => sc[bi] ?? ''))
      : [group];
  } else {
    sections = [group];
  }
  return sections.flatMap(sec => {
    const cols = parseSection(sec, numStrings);
    return cols.length > 0 ? [{ id: newId(), timeSig: DEFAULT_TIME_SIG, columns: cols }] : [];
  });
}

/**
 * Parse plain ASCII tab text (e.g. after the user has edited the OCR output).
 * This is the fallback path — the primary path for printed music uses
 * `buildBarsFromOcrResult` which works from bounding boxes, not text.
 */
export function parseTabText(text: string, numStrings: number): TabBar[] {
  const lines = text.split('\n').map(l => l.trimEnd());
  for (let n = numStrings; n >= 1; n--) {
    const groups = findTabGroups(lines, n);
    if (groups.length === 0) continue;
    const bars = groups.flatMap(g => parseTabGroup(g, n));
    if (bars.length > 0) return bars;
  }
  return [];
}
