import React, { useState, useRef, useEffect } from 'react';
import './TabPage.css';
import { GuitarService } from '../../services/guitar.service';
import { NoteNames } from '../../models/noteNames';
import {
  NoteLength, TimeSig,
  NOTE_LENGTH_BEATS, NOTE_LENGTH_LABEL,
  TIME_SIG_GROUPS,
} from '../../models/playback';
import { TabBar, TabDocument, BendAmount, Articulation, makeBar, makeColumn, newId } from '../../models/tab';
import {
  ocrImage, preprocessImageForOcr, detectStringCountAndLines,
  detectColumnNoteLengths,
  buildBarsFromOcrResult, parseTabText,
  OcrProgress, OcrResult,
} from '../../services/tabImageParser';

interface ITabPage {
  tuning:        number[];
  guitarService: GuitarService;
}

// ── Beat helpers ───────────────────────────────────────────────────────────

function barCapacity(bar: TabBar): number {
  return bar.timeSig.beats * bar.timeSig.beatDurQN;
}

function barBeatsUsed(bar: TabBar): number {
  return bar.columns.reduce((s, c) => s + NOTE_LENGTH_BEATS[c.noteLength], 0);
}

function barIsFull(bar: TabBar): boolean {
  return barBeatsUsed(bar) >= barCapacity(bar) - 0.001;
}

/** Format a quarter-note beat count as a compact string. */
function fmtBeats(qn: number): string {
  if (Math.abs(Math.round(qn) - qn) < 0.005) return String(Math.round(qn));
  const map: [number, string][] = [
    [0.5,  '½'],  [1.5, '1½'], [2.5, '2½'], [3.5, '3½'],
    [0.25, '¼'],  [0.75, '¾'], [1.25, '1¼'], [1.75, '1¾'],
    [2.25, '2¼'], [2.75, '2¾'], [3.25, '3¼'], [3.75, '3¾'],
    [1/3,  '⅓'],  [2/3, '⅔'],  [1+1/3, '1⅓'], [1+2/3, '1⅔'],
    [2+1/3,'2⅓'], [2+2/3,'2⅔'],[3+1/3,'3⅓'],  [3+2/3,'3⅔'],
    [1/6,  '⅙'],  [5/6, '⅚'],  [1+1/6,'1⅙'],  [7/6,'1⅙'],
  ];
  for (const [v, s] of map) if (Math.abs(qn - v) < 0.01) return s;
  return qn.toFixed(2).replace(/\.?0+$/, '');
}

// ── Note / Rest symbol SVG component ──────────────────────────────────────

const NOTE_FLAGS: Partial<Record<NoteLength, number>> = {
  thirtysecond:        3,
  sixteenth:           2,
  'sixteenth-triplet': 2,
  sextuplet:           2,
  eighth:              1,
  'eighth-triplet':    1,
};

function NoteSymbol({
  length,
  isRest = false,
  width  = 12,
  height = 32,
}: {
  length: NoteLength;
  isRest?: boolean;
  width?:  number;
  height?: number;
}) {
  const isTriplet   = (length as string).endsWith('-triplet');
  const isSextuplet = length === 'sextuplet';
  const hasMarker   = isTriplet || isSextuplet;
  const marker      = isSextuplet ? '6' : '3';
  const yOff        = hasMarker ? 6 : 0;   // shift shapes down when "3"/"6" text is above

  // ── Rest shapes ────────────────────────────────────────────────────────
  if (isRest) {
    const baseLen = isTriplet
      ? (length as string).replace('-triplet', '') as NoteLength
      : (isSextuplet ? 'sixteenth' : length);

    const by = 22 + yOff; // base y anchor for rest shapes

    let shape: React.ReactNode;
    switch (baseLen) {
      case 'whole':
        shape = <>
          <line x1="3" y1={by} x2="11" y2={by} stroke="currentColor" strokeWidth="0.8"/>
          <rect x="4.5" y={by} width="5" height="3.5" fill="currentColor"/>
        </>;
        break;
      case 'half':
        shape = <>
          <rect x="4.5" y={by - 4} width="5" height="3.5" fill="currentColor"/>
          <line x1="3" y1={by - 0.5} x2="11" y2={by - 0.5} stroke="currentColor" strokeWidth="0.8"/>
        </>;
        break;
      case 'quarter':
        shape = <path
          d={`M 8.5,${by - 8} L 4.5,${by - 2} L 8,${by + 1} L 4,${by + 9}`}
          stroke="currentColor" strokeWidth="1.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />;
        break;
      case 'eighth':
        shape = <>
          <circle cx="9" cy={by - 7} r="2" fill="currentColor"/>
          <line x1="8" y1={by - 7} x2="4" y2={by + 9} stroke="currentColor" strokeWidth="1.2"/>
          <path d={`M 8,${by - 7} C 12,${by - 5} 12,${by - 1} 8,${by + 2}`}
            stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </>;
        break;
      default: // sixteenth, thirtysecond, tuplets
        shape = <>
          <circle cx="9"   cy={by - 9} r="1.8" fill="currentColor"/>
          <circle cx="7.5" cy={by - 1} r="1.8" fill="currentColor"/>
          <line x1="8" y1={by - 9} x2="4" y2={by + 10} stroke="currentColor" strokeWidth="1.2"/>
          <path d={`M 8,${by - 9} C 12,${by - 7} 12,${by - 3} 8,${by}`}
            stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <path d={`M 6.5,${by - 1} C 10.5,${by + 1} 10.5,${by + 5} 6.5,${by + 8}`}
            stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </>;
    }

    return (
      <svg viewBox="0 0 14 44" width={width} height={height} className="note-sym" aria-hidden="true">
        {hasMarker && (
          <text x="5.5" y="10" fontSize="7" textAnchor="middle" fill="currentColor"
            fontFamily="sans-serif" fontWeight="bold">{marker}</text>
        )}
        {shape}
      </svg>
    );
  }

  // ── Note shapes ────────────────────────────────────────────────────────
  const isOpen   = length === 'whole' || length === 'half';
  const isFilled = !isOpen;
  const hasStem  = length !== 'whole';
  const flags    = NOTE_FLAGS[length] ?? 0;

  const headCX  = 5.5;
  const headCY  = 38;
  const headRX  = 4.5;
  const headRY  = 3;
  const stemX   = headCX + headRX;         // 10
  const stemTop = hasMarker ? 14 : 8;

  return (
    <svg viewBox="0 0 14 44" width={width} height={height} className="note-sym" aria-hidden="true">
      {hasMarker && (
        <text x="5.5" y="10" fontSize="7" textAnchor="middle" fill="currentColor"
          fontFamily="sans-serif" fontWeight="bold">{marker}</text>
      )}
      {isFilled ? (
        <ellipse cx={headCX} cy={headCY} rx={headRX} ry={headRY} fill="currentColor"/>
      ) : (
        <ellipse cx={headCX} cy={headCY} rx={headRX} ry={headRY}
          stroke="currentColor" strokeWidth="1.3" fill="none"/>
      )}
      {hasStem && (
        <line x1={stemX} y1={headCY - headRY + 0.5} x2={stemX} y2={stemTop}
          stroke="currentColor" strokeWidth="1.2"/>
      )}
      {Array.from({ length: flags }, (_, i) => (
        <path
          key={i}
          d={`M ${stemX},${stemTop + i * 6} C ${stemX + 5},${stemTop + i * 6 + 4} ${stemX + 5},${stemTop + i * 6 + 9} ${stemX},${stemTop + i * 6 + 12}`}
          stroke="currentColor" strokeWidth="1.2" fill="none"
        />
      ))}
    </svg>
  );
}

// ── Page-level constants ───────────────────────────────────────────────────

const COL_LABEL: Record<NoteLength, string> = {
  thirtysecond:        '1/32',
  sixteenth:           '1/16',
  eighth:              '1/8',
  quarter:             '1/4',
  half:                '1/2',
  whole:               '1/1',
  'eighth-triplet':    '1/8t',
  'quarter-triplet':   '1/4t',
  'sixteenth-triplet': '1/16t',
  sextuplet:           '1/6',
};

const BEND_OPTIONS: Array<{ val: BendAmount | undefined; label: string; title: string }> = [
  { val: undefined, label: '—',   title: 'No bend'           },
  { val: 1,         label: '½',   title: 'Half-step bend'    },
  { val: 2,         label: '1',   title: 'Full-step bend'    },
  { val: 3,         label: '1½',  title: '1½-step bend'      },
  { val: 4,         label: '2',   title: 'Two-step bend'     },
];

const ART_OPTIONS: Array<{ val: Articulation | undefined; label: string; title: string }> = [
  { val: undefined,     label: '—',  title: 'No articulation' },
  { val: 'hammer',      label: 'h',  title: 'Hammer-on'       },
  { val: 'pulloff',     label: 'p',  title: 'Pull-off'        },
  { val: 'slide-up',    label: '/',  title: 'Slide up'        },
  { val: 'slide-down',  label: '\\', title: 'Slide down'      },
];

/** Tab character shown between columns for each articulation type. */
const ART_CHAR: Record<Articulation, string> = {
  'hammer':     'h',
  'pulloff':    'p',
  'slide-up':   '/',
  'slide-down': '\\',
};

const REGULAR_LENGTHS: NoteLength[] = ['thirtysecond', 'sixteenth', 'eighth', 'quarter', 'half', 'whole'];
const TUPLET_LENGTHS:  NoteLength[] = ['sixteenth-triplet', 'eighth-triplet', 'quarter-triplet', 'sextuplet'];

const NUM_INPUT_FRETS = 13;

// ── OCR preview modal ──────────────────────────────────────────────────────

interface IOcrModal {
  ocrResult:  OcrResult;
  numStrings: number;
  onImport:   (bars: TabBar[]) => void;
  onCancel:   () => void;
}

function OcrPreviewModal({ ocrResult, numStrings, onImport, onCancel }: IOcrModal) {
  // Use the auto-detected string count when available; fall back to user setting
  const effectiveStrings = ocrResult.detectedStringCount ?? numStrings;

  // Primary path: spatial parser using bounding-box Y positions (graphical tab)
  const imageBars = React.useMemo(
    () => buildBarsFromOcrResult(ocrResult, effectiveStrings),
    [ocrResult, effectiveStrings],
  );

  // Fallback path: ASCII text parser (user can edit the raw text)
  const [text, setText] = React.useState(ocrResult.rawText);
  const textBars = parseTabText(text, numStrings);

  const imageOk = imageBars.length > 0;
  const textOk  = textBars.length  > 0;

  return (
    <div className="ocr-overlay" onClick={onCancel}>
      <div className="ocr-modal" onClick={e => e.stopPropagation()}>

        <div className="ocr-modal-header">
          <span className="ocr-modal-title">OCR Result</span>
          <button className="tab-btn" onClick={onCancel}>✕</button>
        </div>

        {/* ── Spatial parse result (primary) ── */}
        <div className={`ocr-section${imageOk ? ' ocr-section--ok' : ''}`}>
          <div className="ocr-section-row">
            <span className={`ocr-modal-count${imageOk ? '' : ' ocr-modal-count--none'}`}>
              {imageOk
                ? `Image analysis: ${imageBars.length} bar${imageBars.length !== 1 ? 's' : ''} found`
                : 'Image analysis: no tab detected — try the text fallback below'}
            </span>
            {imageOk && (
              <button className="tab-btn tab-btn--play" onClick={() => onImport(imageBars)}>
                Import {imageBars.length} bar{imageBars.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
          {imageOk && (
            <p className="ocr-modal-hint">
              {ocrResult.detectedStringCount
                ? <><strong>{ocrResult.detectedStringCount}-string</strong> tab detected automatically.</>
                : <>String count not detected — using your setting ({numStrings} strings).</>
              }
              {' '}Staff lines: {ocrResult.staffLines.length}.
              {' '}Fret numbers: {ocrResult.words.filter(w => /^\d+$/.test(w.text)).length}.
              {' '}{imageBars.reduce((s, b) => s + b.columns.length, 0)} columns total.
              {ocrResult.columnNoteLengths.length > 0
                ? <> Note lengths detected from stems ({ocrResult.columnNoteLengths.length} columns).</>
                : <> Note lengths defaulted to quarter (no stem notation found in image).</>
              }
            </p>
          )}
          {!imageOk && (
            <p className="ocr-modal-hint">
              <strong>Tips:</strong> Crop the image to show <em>only</em> the tab staff
              (remove sheet music notation above). Make sure the image is not blurry.
              Dark-background images are supported automatically.
            </p>
          )}
        </div>

        {/* ── Text fallback ── */}
        <div className="ocr-section">
          <p className="ocr-modal-hint">
            <strong>Text fallback</strong> — edit the raw OCR text below to match ASCII
            tab format, then import. One line per string, top = high e:
            <br /><code>{'e|--5---7---8---|'}</code>
          </p>
          <textarea
            className="ocr-modal-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
          />
          <div className="ocr-modal-footer">
            <span className={`ocr-modal-count${textOk ? '' : ' ocr-modal-count--none'}`}>
              {textOk
                ? `${textBars.length} bar${textBars.length !== 1 ? 's' : ''} found in text`
                : 'No tab pattern found in text'}
            </span>
            <div className="ocr-modal-btns">
              <button className="tab-btn" onClick={onCancel}>Cancel</button>
              <button
                className="tab-btn tab-btn--play"
                disabled={!textOk}
                onClick={() => onImport(textBars)}
              >
                Import from text{textOk ? ` (${textBars.length})` : ''}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function TabPage({ tuning, guitarService }: ITabPage) {
  const numStrings = tuning.length;
  const displayRows = Array.from({ length: numStrings }, (_, r) => r);
  const displayToStringIdx = (dr: number) => numStrings - 1 - dr;

  // ── State ──────────────────────────────────────────────────────────────
  const [bars, setBars] = useState<TabBar[]>(() => [makeBar()]);
  const [selectedBarIdx, setSelectedBarIdx] = useState(0);
  const [selectedColIdx, setSelectedColIdx] = useState(0);
  const [selectedNoteLength, setSelectedNoteLength] = useState<NoteLength>('quarter');

  const [bpm, setBpm] = useState(110);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const isLoopingRef = useRef(false);
  const [playbackPos, setPlaybackPos] = useState<{ barIdx: number; colIdx: number } | null>(null);
  const playbackTimers = useRef<number[]>([]);

  const [timeSigPopup, setTimeSigPopup] = useState<number | null>(null);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [ocrStatus,  setOcrStatus]  = useState<'idle' | 'running' | 'error'>('idle');
  const [ocrMsg,     setOcrMsg]     = useState('');
  const [ocrResult,  setOcrResult]  = useState<OcrResult | null>(null);

  // Clamp selection when bars shrink
  useEffect(() => {
    if (bars.length === 0) return;
    const bi = Math.min(selectedBarIdx, bars.length - 1);
    const maxCi = Math.max(0, (bars[bi]?.columns.length ?? 1) - 1);
    const ci = Math.min(selectedColIdx, maxCi);
    if (bi !== selectedBarIdx) setSelectedBarIdx(bi);
    if (ci !== selectedColIdx) setSelectedColIdx(ci);
  }, [bars]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow-key navigation
  const navRef = useRef<(dir: -1 | 1) => void>(() => {});
  useEffect(() => {
    navRef.current = (dir: -1 | 1) => {
      setSelectedBarIdx(prevBi => {
        setSelectedColIdx(prevCi => {
          const curBar = bars[prevBi];
          if (!curBar) return prevCi;
          const newCi = prevCi + dir;
          if (newCi >= 0 && newCi < curBar.columns.length) {
            const col = curBar.columns[newCi];
            if (col) setSelectedNoteLength(col.noteLength);
            return newCi;
          }
          if (dir === 1 && prevBi < bars.length - 1) return 0;
          if (dir === -1 && prevBi > 0) {
            const prevBar = bars[prevBi - 1];
            const lastCi = prevBar.columns.length - 1;
            const col = prevBar.columns[lastCi];
            if (col) setSelectedNoteLength(col.noteLength);
            return lastCi;
          }
          return prevCi;
        });
        const curBar = bars[prevBi];
        if (!curBar) return prevBi;
        if (dir === 1  && selectedColIdx >= curBar.columns.length - 1 && prevBi < bars.length - 1) return prevBi + 1;
        if (dir === -1 && selectedColIdx <= 0                          && prevBi > 0)               return prevBi - 1;
        return prevBi;
      });
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); navRef.current(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navRef.current(-1); }
      if (e.key === 'Escape')     { setTimeSigPopup(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Cell-state queries ─────────────────────────────────────────────────
  function selectColumn(barIdx: number, colIdx: number) {
    setSelectedBarIdx(barIdx);
    setSelectedColIdx(colIdx);
    const col = bars[barIdx]?.columns[colIdx];
    if (col) setSelectedNoteLength(col.noteLength);
    setTimeSigPopup(null);
  }

  function isFretActive(stringIdx: number, fret: number): boolean {
    const col = bars[selectedBarIdx]?.columns[selectedColIdx];
    return col?.notes.some(n => n.stringIdx === stringIdx && n.fret === fret && !n.muted) ?? false;
  }
  function isFretBent(stringIdx: number, fret: number): boolean {
    const col = bars[selectedBarIdx]?.columns[selectedColIdx];
    const note = col?.notes.find(n => n.stringIdx === stringIdx && n.fret === fret && !n.muted);
    return note?.bend !== undefined;
  }
  function isMuteActive(stringIdx: number): boolean {
    const col = bars[selectedBarIdx]?.columns[selectedColIdx];
    return col?.notes.some(n => n.stringIdx === stringIdx && n.muted === true) ?? false;
  }
  function isFretPlaying(stringIdx: number, fret: number): boolean {
    if (!playbackPos) return false;
    const col = bars[playbackPos.barIdx]?.columns[playbackPos.colIdx];
    return col?.notes.some(n => n.stringIdx === stringIdx && n.fret === fret && !n.muted) ?? false;
  }
  function isMutePlaying(stringIdx: number): boolean {
    if (!playbackPos) return false;
    const col = bars[playbackPos.barIdx]?.columns[playbackPos.colIdx];
    return col?.notes.some(n => n.stringIdx === stringIdx && n.muted === true) ?? false;
  }

  // ── Mutations ──────────────────────────────────────────────────────────
  function toggleNote(displayRow: number, fret: number) {
    if (isPlaying) return;
    const col = bars[selectedBarIdx]?.columns[selectedColIdx];
    if (col?.isRest) return;
    const stringIdx = displayToStringIdx(displayRow);
    setBars(prev => {
      const next = prev.map(b => ({ ...b, columns: b.columns.map(c => ({ ...c, notes: [...c.notes] })) }));
      const c = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!c) return prev;
      const ei = c.notes.findIndex(n => n.stringIdx === stringIdx);
      if (ei >= 0) {
        const ex = c.notes[ei];
        if (ex.fret === fret && !ex.muted) c.notes.splice(ei, 1);
        else c.notes[ei] = { stringIdx, fret };
      } else {
        c.notes.push({ stringIdx, fret });
      }
      return next;
    });
    guitarService.audioContext.resume().then(() => {
      guitarService.playNote(tuning[stringIdx] + fret, 'clean');
    });
  }

  function toggleMute(displayRow: number) {
    if (isPlaying) return;
    const col = bars[selectedBarIdx]?.columns[selectedColIdx];
    if (col?.isRest) return;
    const stringIdx = displayToStringIdx(displayRow);
    setBars(prev => {
      const next = prev.map(b => ({ ...b, columns: b.columns.map(c => ({ ...c, notes: [...c.notes] })) }));
      const c = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!c) return prev;
      const ei = c.notes.findIndex(n => n.stringIdx === stringIdx);
      if (ei >= 0) {
        if (c.notes[ei].muted) c.notes.splice(ei, 1);
        else c.notes[ei] = { stringIdx, fret: 0, muted: true };
      } else {
        c.notes.push({ stringIdx, fret: 0, muted: true });
      }
      return next;
    });
    guitarService.audioContext.resume().then(() => {
      guitarService.playMutedNote(guitarService.audioContext.currentTime);
    });
  }

  function setBendForNote(stringIdx: number, bend: BendAmount | undefined) {
    setBars(prev => {
      const next = prev.map(b => ({
        ...b, columns: b.columns.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      }));
      const col = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!col) return prev;
      const note = col.notes.find(n => n.stringIdx === stringIdx && !n.muted);
      if (note) note.bend = bend;
      return next;
    });
  }

  function setArticulationForNote(stringIdx: number, art: Articulation | undefined) {
    setBars(prev => {
      const next = prev.map(b => ({
        ...b, columns: b.columns.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      }));
      const col = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!col) return prev;
      const note = col.notes.find(n => n.stringIdx === stringIdx && !n.muted);
      if (note) note.articulation = art;
      return next;
    });
  }

  function togglePalmMutedForNote(stringIdx: number) {
    setBars(prev => {
      const next = prev.map(b => ({
        ...b, columns: b.columns.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      }));
      const col = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!col) return prev;
      const note = col.notes.find(n => n.stringIdx === stringIdx);
      if (note) note.palmMuted = note.palmMuted ? undefined : true;
      return next;
    });
  }

  function toggleVibratoForNote(stringIdx: number) {
    setBars(prev => {
      const next = prev.map(b => ({
        ...b, columns: b.columns.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      }));
      const col = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!col) return prev;
      const note = col.notes.find(n => n.stringIdx === stringIdx && !n.muted);
      if (note) note.vibrato = note.vibrato ? undefined : true;
      return next;
    });
  }

  function toggleHarmonicForNote(stringIdx: number) {
    setBars(prev => {
      const next = prev.map(b => ({
        ...b, columns: b.columns.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      }));
      const col = next[selectedBarIdx]?.columns[selectedColIdx];
      if (!col) return prev;
      const note = col.notes.find(n => n.stringIdx === stringIdx && !n.muted);
      if (note) note.harmonic = note.harmonic ? undefined : true;
      return next;
    });
  }

  function toggleRest() {
    if (isPlaying) return;
    setBars(prev => prev.map((b, bi) => {
      if (bi !== selectedBarIdx) return b;
      return {
        ...b,
        columns: b.columns.map((c, ci) => {
          if (ci !== selectedColIdx) return c;
          return c.isRest
            ? { ...c, isRest: undefined }
            : { ...c, isRest: true, notes: [] };
        }),
      };
    }));
  }

  // ── Bar / column management ────────────────────────────────────────────
  function addColumnToBar(barIdx: number) {
    const bar = bars[barIdx];
    if (!bar) return;

    const capacity   = barCapacity(bar);
    const used       = barBeatsUsed(bar);
    const newBeats   = NOTE_LENGTH_BEATS[selectedNoteLength];

    // Refuse if bar is already full or note doesn't fit
    if (used + newBeats > capacity + 0.001) return;

    const newColIdx  = bar.columns.length;
    const willFill   = Math.abs(used + newBeats - capacity) < 0.005;

    setBars(prev => {
      const next = prev.map((b, bi) =>
        bi !== barIdx ? b : { ...b, columns: [...b.columns, makeColumn(selectedNoteLength)] }
      );
      if (willFill && barIdx + 1 >= next.length) {
        // Auto-create next bar inheriting the time sig
        const newBar: TabBar = {
          id:      newId(),
          timeSig: bar.timeSig,
          columns: [makeColumn(selectedNoteLength)],
        };
        return [...next, newBar];
      }
      return next;
    });

    if (willFill) {
      setSelectedBarIdx(barIdx + 1);
      setSelectedColIdx(0);
    } else {
      setSelectedBarIdx(barIdx);
      setSelectedColIdx(newColIdx);
    }
  }

  function addColumn() { addColumnToBar(selectedBarIdx); }

  function deleteColumn() {
    const bar = bars[selectedBarIdx];
    if (!bar || bar.columns.length <= 1) return;
    setBars(prev => prev.map((b, bi) => {
      if (bi !== selectedBarIdx) return b;
      return { ...b, columns: b.columns.filter((_, ci) => ci !== selectedColIdx) };
    }));
    setSelectedColIdx(ci => Math.min(ci, bar.columns.length - 2));
  }

  function addBar() {
    setBars(prev => [...prev, makeBar(bars[selectedBarIdx]?.timeSig, selectedNoteLength)]);
    setSelectedBarIdx(bars.length);
    setSelectedColIdx(0);
  }

  function deleteBar(barIdx: number) {
    if (bars.length <= 1) return;
    setBars(prev => prev.filter((_, i) => i !== barIdx));
    setSelectedBarIdx(bi => Math.max(0, barIdx <= bi ? bi - 1 : bi));
    setSelectedColIdx(0);
    setTimeSigPopup(null);
  }

  function updateBarTimeSig(barIdx: number, ts: TimeSig) {
    setBars(prev => prev.map((b, i) => i === barIdx ? { ...b, timeSig: ts } : b));
    setTimeSigPopup(null);
  }

  function applyNoteLength(nl: NoteLength) {
    setSelectedNoteLength(nl);
    setBars(prev => prev.map((b, bi) => {
      if (bi !== selectedBarIdx) return b;
      return {
        ...b,
        columns: b.columns.map((c, ci) =>
          ci === selectedColIdx ? { ...c, noteLength: nl } : c
        ),
      };
    }));
  }

  function clearAll() {
    stopPlayback();
    setBars([makeBar()]);
    setSelectedBarIdx(0);
    setSelectedColIdx(0);
  }

  // ── Save / Load ────────────────────────────────────────────────────────
  async function saveTab() {
    const doc: TabDocument = { version: 1, bpm, bars };
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const suggestedName = `tab-${new Date().toISOString().slice(0, 10)}.json`;

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Tab JSON', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (e) {
        if ((e as any).name !== 'AbortError') throw e;
      }
    } else {
      const name = window.prompt('Save as:', suggestedName);
      if (name === null) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = name.endsWith('.json') ? name : `${name}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function loadTabFile() {
    fileInputRef.current?.click();
  }

  function handleFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const doc = JSON.parse(evt.target?.result as string) as TabDocument;
        if (doc.version === 1 && Array.isArray(doc.bars)) {
          stopPlayback();
          setBars(doc.bars);
          setBpm(doc.bpm ?? 110);
          setSelectedBarIdx(0);
          setSelectedColIdx(0);
        }
      } catch {
        // ignore malformed JSON
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Image import (OCR) ────────────────────────────────────────────────
  function loadTabImage() {
    imageInputRef.current?.click();
  }

  async function handleImageLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setOcrStatus('running');
    setOcrMsg('Preparing image…');

    try {
      const processed = await preprocessImageForOcr(file);

      const onProgress = ({ status, progress }: OcrProgress) => {
        setOcrMsg(`${status} ${Math.round(progress * 100)}%`);
      };

      // Run OCR and string-count / staff-line detection in parallel on the same blob
      const [ocrData, { count, lines }] = await Promise.all([
        ocrImage(processed, onProgress),
        detectStringCountAndLines(processed),
      ]);

      // Detect note lengths from stems/beams above the staff
      setOcrMsg('Detecting note lengths…');
      const columnNoteLengths = await detectColumnNoteLengths(processed, ocrData.words, lines);

      setOcrStatus('idle');
      setOcrMsg('');
      setOcrResult({ ...ocrData, staffLines: lines, detectedStringCount: count, columnNoteLengths });
    } catch {
      setOcrStatus('error');
      setOcrMsg('OCR failed — please try again');
      setTimeout(() => { setOcrStatus('idle'); setOcrMsg(''); }, 5000);
    }
  }

  function confirmOcrImport(newBars: TabBar[]) {
    if (newBars.length === 0) return;
    stopPlayback();
    setBars(newBars);
    setSelectedBarIdx(0);
    setSelectedColIdx(0);
    setOcrResult(null);
  }

  // ── Playback ───────────────────────────────────────────────────────────
  function schedulePlayback(
    capturedBars: TabBar[],
    capturedBpm: number,
    capturedTuning: number[],
  ) {
    const ctx        = guitarService.audioContext;
    const startAudio = ctx.currentTime + 0.05;
    let time         = startAudio;
    const timers: number[] = [];

    // Track the last-played fret per string so slides can reference the source pitch.
    const lastFretPerString: number[] = new Array(capturedTuning.length).fill(-1);

    for (let bi = 0; bi < capturedBars.length; bi++) {
      for (let ci = 0; ci < capturedBars[bi].columns.length; ci++) {
        const col = capturedBars[bi].columns[ci];
        const dur = NOTE_LENGTH_BEATS[col.noteLength] * (60 / capturedBpm);

        if (!col.isRest) {
          col.notes.forEach(note => {
            if (note.muted) {
              guitarService.playMutedNote(time);
            } else {
              const midi = capturedTuning[note.stringIdx] + note.fret;
              const art  = note.articulation;
              const prev = lastFretPerString[note.stringIdx];

              if (art === 'hammer') {
                guitarService.playHammerOnAt(midi, 'clean', time, dur * 0.85, dur * 0.15);
              } else if (art === 'pulloff') {
                guitarService.playPullOffAt(midi, 'clean', time, dur * 0.85, dur * 0.15);
              } else if ((art === 'slide-up' || art === 'slide-down') && prev >= 0) {
                const fromMidi = capturedTuning[note.stringIdx] + prev;
                guitarService.playSlideAt(fromMidi, midi, 'clean', time, dur * 0.85, dur * 0.15);
              } else if (note.bend) {
                guitarService.playBendNoteAt(midi, note.bend, 'clean', time, dur * 0.85, dur * 0.15);
              } else {
                guitarService.playNoteAt(midi, 'clean', time, dur * 0.85, dur * 0.15);
              }
            }
            lastFretPerString[note.stringIdx] = note.fret;
          });
        }

        const delay = Math.max(0, (time - startAudio) * 1000);
        const cBi = bi, cCi = ci;
        timers.push(window.setTimeout(
          () => setPlaybackPos({ barIdx: cBi, colIdx: cCi }),
          delay,
        ));
        time += dur;
      }
    }

    const totalMs = (time - startAudio) * 1000;
    timers.push(window.setTimeout(() => {
      if (isLoopingRef.current) {
        playbackTimers.current = [];
        schedulePlayback(capturedBars, capturedBpm, capturedTuning);
      } else {
        setIsPlaying(false);
        setPlaybackPos(null);
      }
    }, totalMs));

    playbackTimers.current = timers;
  }

  function startPlayback() {
    if (isPlaying) return;
    const capturedBars   = bars;
    const capturedBpm    = bpm;
    const capturedTuning = tuning;

    guitarService.audioContext.resume().then(() => {
      setIsPlaying(true);
      schedulePlayback(capturedBars, capturedBpm, capturedTuning);
    });
  }

  function stopPlayback() {
    playbackTimers.current.forEach(id => clearTimeout(id));
    playbackTimers.current = [];
    setIsPlaying(false);
    setPlaybackPos(null);
  }

  function toggleLoop() {
    setIsLooping(prev => {
      isLoopingRef.current = !prev;
      return !prev;
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────
  const fretHeaders  = Array.from({ length: NUM_INPUT_FRETS }, (_, f) => f);
  const selectedCol  = bars[selectedBarIdx]?.columns[selectedColIdx];
  const currentBar   = bars[selectedBarIdx];
  const selIsRest    = selectedCol?.isRest ?? false;

  return (
    <div className="tab-page" onClick={() => setTimeSigPopup(null)}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="tab-toolbar">

        <div className="tab-tb-group">
          <span className="tab-tb-label">BPM</span>
          <input
            type="range" min={40} max={240} step={1} value={bpm}
            className="tab-bpm-slider"
            onChange={e => setBpm(+e.target.value)}
          />
          <span className="tab-bpm-val">{bpm}</span>
        </div>

        <div className="tab-tb-group tab-tb-group--note">
          <span className="tab-tb-label">Note</span>
          <div className="tab-nl-rows">
            <div className="tab-nl-row">
              {REGULAR_LENGTHS.map(nl => (
                <button
                  key={nl}
                  className={`tab-nl-btn${selectedNoteLength === nl ? ' tab-nl-btn--active' : ''}`}
                  title={NOTE_LENGTH_LABEL[nl]}
                  onClick={() => applyNoteLength(nl)}
                >
                  <NoteSymbol length={nl} width={10} height={22} />
                  <span className="tab-nl-lbl">{NOTE_LENGTH_LABEL[nl]}</span>
                </button>
              ))}
            </div>
            <div className="tab-nl-row tab-nl-row--tuplet">
              {TUPLET_LENGTHS.map(nl => (
                <button
                  key={nl}
                  className={`tab-nl-btn${selectedNoteLength === nl ? ' tab-nl-btn--active' : ''}`}
                  title={NOTE_LENGTH_LABEL[nl]}
                  onClick={() => applyNoteLength(nl)}
                >
                  <NoteSymbol length={nl} width={10} height={22} />
                  <span className="tab-nl-lbl">{NOTE_LENGTH_LABEL[nl]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="tab-tb-group">
          {isPlaying
            ? <button className="tab-btn tab-btn--stop"  onClick={stopPlayback}>■ Stop</button>
            : <button className="tab-btn tab-btn--play"  onClick={startPlayback}>▶ Play</button>
          }
          <button
            className={`tab-btn${isLooping ? ' tab-btn--loop-active' : ''}`}
            onClick={toggleLoop}
            title={isLooping ? 'Loop: on (click to turn off)' : 'Loop: off (click to turn on)'}
          >
            ⟳ Loop
          </button>
        </div>

        <div className="tab-tb-group">
          <button className="tab-btn" title="Previous column (←)" onClick={() => navRef.current(-1)}>←</button>
          <button className="tab-btn" title="Next column (→)"     onClick={() => navRef.current(1)}>→</button>
          <button
            className="tab-btn"
            onClick={addColumn}
            disabled={!!(currentBar && barIsFull(currentBar))}
            title={currentBar && barIsFull(currentBar) ? 'Bar is full' : 'Add column'}
          >
            + Col
          </button>
          <button className="tab-btn tab-btn--danger" onClick={deleteColumn} title="Delete selected column">✕ Col</button>
          <button
            className={`tab-btn${selIsRest ? ' tab-btn--rest-active' : ''}`}
            onClick={toggleRest}
            title="Toggle rest"
          >
            ⊘ Rest
          </button>
          <button className="tab-btn" onClick={addBar}>+ Bar</button>
          <button className="tab-btn tab-btn--danger" onClick={clearAll}>Clear</button>
        </div>

        <div className="tab-tb-group">
          <button className="tab-btn" onClick={saveTab} title="Save tab as JSON">⬇ Save</button>
          <button className="tab-btn" onClick={loadTabFile} title="Load tab from JSON">⬆ Load</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleFileLoad}
          />
          <button
            className="tab-btn"
            onClick={loadTabImage}
            disabled={ocrStatus === 'running'}
            title="Import tab from an image (OCR)"
          >
            {ocrStatus === 'running' ? 'OCR…' : '⬆ Img'}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageLoad}
          />
        </div>

      </div>

      {/* ── Fretboard Input ───────────────────────────────────────────────── */}
      <div className="tab-fb-section">
        <div className={`tab-fb-hint${ocrStatus === 'error' ? ' tab-fb-hint--error' : ''}`}>
          {ocrStatus === 'running'
            ? `OCR: ${ocrMsg}`
            : ocrStatus === 'error'
              ? ocrMsg
              : isPlaying
                ? 'Playback in progress…'
                : selIsRest
                  ? `Bar ${selectedBarIdx + 1}  ·  Col ${selectedColIdx + 1}  —  rest (toggle ⊘ Rest to add notes)`
                  : `Bar ${selectedBarIdx + 1}  ·  Col ${selectedColIdx + 1}  —  click frets to toggle notes  ·  ✕ = muted`}
        </div>
        <div className="tab-fb-grid">
          <div className="tab-fb-row tab-fb-row--header">
            <div className="tab-fb-label-cell" />
            <div className="tab-fb-fret-label tab-fb-fret-label--mute">✕</div>
            {fretHeaders.map(f => (
              <div key={f} className="tab-fb-fret-label">{f === 0 ? 'O' : f}</div>
            ))}
          </div>

          {displayRows.map(displayRow => {
            const stringIdx = displayToStringIdx(displayRow);
            const muteActive  = isMuteActive(stringIdx);
            const mutePlaying = isMutePlaying(stringIdx);
            return (
              <div key={displayRow} className={`tab-fb-row${selIsRest ? ' tab-fb-row--rest' : ''}`}>
                <div className="tab-fb-label-cell">{NoteNames.get(tuning[stringIdx])}</div>

                <div
                  className={[
                    'tab-fb-cell tab-fb-cell--mute-toggle',
                    muteActive  ? 'tab-fb-cell--muted'   : '',
                    mutePlaying ? 'tab-fb-cell--playing'  : '',
                  ].filter(Boolean).join(' ')}
                  onClick={e => { e.stopPropagation(); toggleMute(displayRow); }}
                  title={`Mute ${NoteNames.get(tuning[stringIdx])} string`}
                >
                  {(muteActive || mutePlaying) ? 'x' : ''}
                </div>

                {fretHeaders.map(fret => {
                  const active  = isFretActive(stringIdx, fret);
                  const bent    = active && isFretBent(stringIdx, fret);
                  const playing = isFretPlaying(stringIdx, fret);
                  return (
                    <div
                      key={fret}
                      className={[
                        'tab-fb-cell',
                        active && !bent ? 'tab-fb-cell--active'  : '',
                        bent            ? 'tab-fb-cell--bent'    : '',
                        playing         ? 'tab-fb-cell--playing' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={e => { e.stopPropagation(); toggleNote(displayRow, fret); }}
                      title={`${NoteNames.get(tuning[stringIdx] + fret)} — ${NoteNames.get(tuning[stringIdx])} str, fret ${fret}`}
                    >
                      {(active || playing) ? (bent ? `${fret}b` : fret) : ''}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {selectedCol && selectedCol.notes.length > 0 && !selIsRest && (
          <div className="tab-note-props" onClick={e => e.stopPropagation()}>
            <span className="tab-note-props-title">Column notes:</span>
            {selectedCol.notes
              .slice()
              .sort((a, b) => b.stringIdx - a.stringIdx)
              .map(note => (
                <div key={note.stringIdx} className="tab-note-prop-row">
                  <span className="tab-note-prop-name">
                    <strong>{NoteNames.get(tuning[note.stringIdx])}</strong>
                    {note.muted ? ' — muted' : ` — fret ${note.fret}`}
                  </span>
                  {!note.muted && (<>
                    <span className="tab-note-prop-bend">
                      <span className="tab-note-prop-lbl">Bend:</span>
                      {BEND_OPTIONS.map(opt => (
                        <button
                          key={opt.label}
                          className={`tab-bend-btn${note.bend === opt.val ? ' tab-bend-btn--active' : ''}`}
                          title={opt.title}
                          onClick={() => setBendForNote(note.stringIdx, opt.val)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </span>
                    <span className="tab-note-prop-bend">
                      <span className="tab-note-prop-lbl">Art:</span>
                      {ART_OPTIONS.map(opt => (
                        <button
                          key={opt.label}
                          className={`tab-bend-btn${note.articulation === opt.val ? ' tab-bend-btn--active tab-bend-btn--art' : ''}`}
                          title={opt.title}
                          onClick={() => setArticulationForNote(note.stringIdx, opt.val)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </span>
                    <span className="tab-note-prop-bend">
                      <span className="tab-note-prop-lbl">FX:</span>
                      <button
                        className={`tab-bend-btn${note.palmMuted ? ' tab-bend-btn--active tab-bend-btn--pm' : ''}`}
                        title="Palm mute"
                        onClick={() => togglePalmMutedForNote(note.stringIdx)}
                      >PM</button>
                      <button
                        className={`tab-bend-btn${note.vibrato ? ' tab-bend-btn--active tab-bend-btn--vib' : ''}`}
                        title="Vibrato"
                        onClick={() => toggleVibratoForNote(note.stringIdx)}
                      >~</button>
                      <button
                        className={`tab-bend-btn${note.harmonic ? ' tab-bend-btn--active tab-bend-btn--harm' : ''}`}
                        title="Natural harmonic"
                        onClick={() => toggleHarmonicForNote(note.stringIdx)}
                      >&lt;&gt;</button>
                    </span>
                  </>)}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── Tab Notation Editor ───────────────────────────────────────────── */}
      <div className="tab-editor-wrap">
        <div className="tab-bars-area">
          {bars.map((bar, barIdx) => {
            const used     = barBeatsUsed(bar);
            const capacity = barCapacity(bar);
            const isFull   = Math.abs(used - capacity) < 0.005;
            const isOver   = used > capacity + 0.005;
            return (
              <div
                key={bar.id}
                className={`tab-bar${selectedBarIdx === barIdx ? ' tab-bar--active' : ''}`}
              >
                {/* Bar header */}
                <div className="tab-bar-header">
                  <span className="tab-bar-num">Bar {barIdx + 1}</span>
                  <span className={[
                    'tab-bar-beats',
                    isFull ? 'tab-bar-beats--full' : isOver ? 'tab-bar-beats--over' : '',
                  ].filter(Boolean).join(' ')}>
                    {fmtBeats(used)}/{fmtBeats(capacity)}
                  </span>
                  <div className="tab-ts-wrapper" onClick={e => e.stopPropagation()}>
                    <button
                      className="tab-ts-toggle"
                      onClick={() => setTimeSigPopup(timeSigPopup === barIdx ? null : barIdx)}
                    >
                      {bar.timeSig.label} ▾
                    </button>
                    {timeSigPopup === barIdx && (
                      <div className="tab-ts-popup">
                        {TIME_SIG_GROUPS.map(group => (
                          <div key={group.category} className="tab-ts-group">
                            <div className="tab-ts-group-lbl">{group.category}</div>
                            <div className="tab-ts-group-row">
                              {group.sigs.map(ts => (
                                <button
                                  key={ts.label}
                                  className={`tab-ts-sig${bar.timeSig.label === ts.label ? ' tab-ts-sig--active' : ''}`}
                                  onClick={() => updateBarTimeSig(barIdx, ts)}
                                >
                                  {ts.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {bars.length > 1 && (
                          <button className="tab-ts-del" onClick={() => deleteBar(barIdx)}>
                            Delete Bar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bar inner: string labels + columns */}
                <div className="tab-bar-inner">
                  <div className="tab-bar-labels">
                    <div className="tab-bar-lbl-spacer" />
                    {barIdx === 0 ? (
                      <div className="tab-bar-clef" style={{ height: numStrings * 28 }}>
                        <span>T</span><span>A</span><span>B</span>
                      </div>
                    ) : (
                      displayRows.map(displayRow => (
                        <div key={displayRow} className="tab-bar-lbl-cell">
                          {NoteNames.get(tuning[displayToStringIdx(displayRow)])}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="tab-bar-body">
                    {bar.columns.map((col, colIdx) => {
                      const isSel  = selectedBarIdx === barIdx && selectedColIdx === colIdx;
                      const isPlay = playbackPos?.barIdx === barIdx && playbackPos?.colIdx === colIdx;
                      return (
                        <div
                          key={col.id}
                          className={[
                            'tab-col',
                            isSel        ? 'tab-col--selected' : '',
                            isPlay       ? 'tab-col--playing'  : '',
                            col.isRest   ? 'tab-col--rest'     : '',
                          ].filter(Boolean).join(' ')}
                          onClick={e => { e.stopPropagation(); selectColumn(barIdx, colIdx); }}
                        >
                          <div className="tab-col-len">
                            <NoteSymbol
                              length={col.noteLength}
                              isRest={col.isRest}
                              width={12}
                              height={28}
                            />
                            <span className="tab-col-len-lbl">{COL_LABEL[col.noteLength]}</span>
                            {col.notes.some(n => n.palmMuted) && (
                              <span className="tab-col-pm-badge">PM</span>
                            )}
                          </div>

                          {displayRows.map(displayRow => {
                            const stringIdx = displayToStringIdx(displayRow);
                            const note      = col.notes.find(n => n.stringIdx === stringIdx);
                            const isMuted   = note?.muted    === true;
                            const hasBend   = !isMuted && note?.bend      !== undefined;
                            const isVib     = !isMuted && note?.vibrato   === true;
                            const isHarm    = !isMuted && note?.harmonic  === true;
                            const isPM      = note?.palmMuted === true;
                            const art       = !isMuted ? note?.articulation : undefined;
                            const display   = note === undefined
                              ? ''
                              : isMuted
                                ? 'x'
                                : isHarm
                                  ? `<${note.fret}>`
                                  : hasBend
                                    ? `${note.fret}b`
                                    : isVib
                                      ? `${note.fret}~`
                                      : String(note.fret);
                            return (
                              <div key={displayRow} className="tab-col-cell">
                                {art && (
                                  <span className={`tab-art-conn tab-art-conn--${art}`}>
                                    {ART_CHAR[art]}
                                  </span>
                                )}
                                <span className={[
                                  'tab-col-num',
                                  note !== undefined ? 'tab-col-num--filled' : '',
                                  isMuted  ? 'tab-col-num--muted'   : '',
                                  hasBend  ? 'tab-col-num--bend'    : '',
                                  isVib    ? 'tab-col-num--vibrato' : '',
                                  isHarm   ? 'tab-col-num--harm'    : '',
                                  isPM     ? 'tab-col-num--pm'      : '',
                                ].filter(Boolean).join(' ')}>
                                  {display}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {!barIsFull(bar) && (
                      <button
                        className="tab-add-col"
                        title="Add column to this bar"
                        onClick={e => { e.stopPropagation(); addColumnToBar(barIdx); }}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <button className="tab-add-bar" onClick={e => { e.stopPropagation(); addBar(); }}>
            + Bar
          </button>
        </div>
      </div>

      {ocrResult !== null && (
        <OcrPreviewModal
          ocrResult={ocrResult}
          numStrings={numStrings}
          onImport={confirmOcrImport}
          onCancel={() => setOcrResult(null)}
        />
      )}

    </div>
  );
}
