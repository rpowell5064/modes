import React from 'react';
import ReactDOM from 'react-dom';
import { Note } from '../note/Note';
import './Fretboard.css';
import { Modes } from '../../models/modes';
import { NoteNames } from '../../models/noteNames';
import { GuitarService, SoundMode } from '../../services/guitar.service';
import {
    NoteLength, TimeSig, TIME_SIG_GROUPS,
    NOTE_LENGTH_BEATS, NOTE_LENGTH_OPTIONS, NOTE_LENGTH_LABEL,
    LOOKAHEAD_S, TICK_MS,
} from '../../models/playback';

interface IFretboard {
  numOfFrets: number;
  keySig: number;
  mode: number;
  tuning: number[];
  soundMode: SoundMode;
  guitarService: GuitarService;
  showPattern: boolean;
  bpm:        number;
  timeSig:    TimeSig;
  noteLength: NoteLength;
}

interface FretboardState {
  soloPattern:       number | null;
  isMobile:          boolean;
  isPlayingScale:    boolean;
  scaleBpm:          number;
  scaleNoteLen:      NoteLength;
  scaleTimeSig:      TimeSig;
  scaleBeat:         number;
  activeNote:        { stringIdx: number; fret: number } | null;
  synced:            boolean;
  showScaleControls: boolean;
  scaleCtrlRoot:     Element | null;
}

const INLAY_FRETS     = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21]);
const DBL_INLAY_FRETS = new Set([12]);

const PAD = 6;

const PATTERN_COLORS = [
  { stroke: '#22d3ee', fill: 'rgba(34,  211, 238, 0.07)' },
  { stroke: '#f97316', fill: 'rgba(249, 115,  22, 0.07)' },
  { stroke: '#a855f7', fill: 'rgba(168,  85, 247, 0.07)' },
  { stroke: '#f472b6', fill: 'rgba(244, 114, 182, 0.07)' },
  { stroke: '#84cc16', fill: 'rgba(132, 204,  22, 0.07)' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158,  11, 0.07)' },
  { stroke: '#38bdf8', fill: 'rgba( 56, 189, 248, 0.07)' },
];

interface PatternPosition {
  index:  number;
  center: number;
  label:  string;
  color:  { stroke: string; fill: string };
  boxMin: number;
  boxMax: number;
  chipX:  number;   // px from left of fret-area container
  stringRanges: { minFret: number; maxFret: number }[];
}

export class Fretboard extends React.Component<IFretboard, FretboardState> {

  // ── Scale playback scheduler ──────────────────────────────────────────────
  private scaleIntervalId: number | null = null;
  private scaleIsPlaying   = false;
  private scaleNextNoteT   = 0;
  private scaleNextBeatT   = 0;
  private scaleNextNoteIdx = 0;
  private scaleNextBeatIdx = 0;
  private scaleUiTimers:   number[] = [];
  private cachedScaleNotes: { midiNote: number; stringIdx: number; fret: number }[] = [];

  constructor(props: IFretboard) {
    super(props);
    this.state = {
      soloPattern:       null,
      isMobile:          window.innerWidth <= 600,
      isPlayingScale:    false,
      scaleBpm:          props.bpm,
      scaleNoteLen:      props.noteLength,
      scaleTimeSig:      props.timeSig,
      scaleBeat:         -1,
      activeNote:        null,
      synced:            true,
      showScaleControls: false,
      scaleCtrlRoot:     null,
    };
    this.handleResize = this.handleResize.bind(this);
  }

  componentDidMount() {
    window.addEventListener('resize', this.handleResize);
    if (this.props.showPattern) this.selectKeyPattern();
    this.setState({ scaleCtrlRoot: document.getElementById('scale-ctrl-root') });
  }

  componentWillUnmount() {
    this.stopScalePlay();
    window.removeEventListener('resize', this.handleResize);
  }

  private handleResize() {
    const isMobile = window.innerWidth <= 600;
    if (isMobile !== this.state.isMobile) this.setState({ isMobile });
  }

  // ── Responsive layout constants ─────────────────────────────────────────
  private get OPEN_W()   { return this.state.isMobile ? 42 : 52; }
  private get NUT_W()    { return this.state.isMobile ? 10 : 14; }
  private get FRET_W()   { return this.state.isMobile ? 44 : 52; }
  private get ROW_H()    { return this.state.isMobile ? 52 : 64; }
  private get HEADER_H() { return this.state.isMobile ? 20 : 26; }

  componentDidUpdate(prevProps: IFretboard, prevState: FretboardState) {
    const { showPattern, keySig, mode, bpm, timeSig, noteLength } = this.props;
    if (!prevProps.showPattern && showPattern) {
      this.selectKeyPattern();
    } else if (prevProps.showPattern && !showPattern) {
      this.setState({ soloPattern: null });
    } else if (showPattern && (prevProps.keySig !== keySig || prevProps.mode !== mode)) {
      this.selectKeyPattern();
    }
    // Propagate global playback changes when synced
    if (this.state.synced) {
      const globalChanged =
        prevProps.bpm        !== bpm        ||
        prevProps.timeSig    !== timeSig    ||
        prevProps.noteLength !== noteLength;
      if (globalChanged) {
        this.setState({ scaleBpm: bpm, scaleTimeSig: timeSig, scaleNoteLen: noteLength });
      }
    }
    // If scale is playing and key/mode/pattern changed: refresh the note list
    if (this.scaleIsPlaying) {
      const changed =
        prevState.soloPattern !== this.state.soloPattern ||
        prevProps.keySig      !== this.props.keySig      ||
        prevProps.mode        !== this.props.mode;
      if (changed) {
        const notes = this.computeScaleNotes();
        if (!notes.length) { this.stopScalePlay(); }
        else { this.cachedScaleNotes = notes; this.scaleNextNoteIdx = 0; }
      }
    }
    // Auto-stop if pattern deselected
    if (this.scaleIsPlaying && this.state.soloPattern === null) {
      this.stopScalePlay();
    }
  }

  private selectKeyPattern() {
    const positions = this.computePositions();
    const keyLabel  = NoteNames.get(this.props.keySig);
    const idx       = positions.findIndex(p => p.label === keyLabel);
    this.setState({ soloPattern: idx >= 0 ? idx : null });
  }

  // mode indices 7 = Major Pentatonic, 8 = Minor Pentatonic, 9 = Blues Pentatonic
  // all use 2 notes per string as the base (blues adds a 3rd only on half-step runs).
  private isPentatonic(): boolean {
    return this.props.mode === 7 || this.props.mode === 8 || this.props.mode === 9;
  }

  isMarked(note: number): boolean {
    const mode = Modes.all()[this.props.mode];
    for (let i = 0; i < mode.length; i++) {
      const interval = this.props.keySig + mode[i];
      const isOctave =
        note - 12 === interval || note + 12 === interval ||
        note - 24 === interval || note + 24 === interval ||
        note - 36 === interval || note + 36 === interval;
      if (note === interval || isOctave) return true;
    }
    return false;
  }

  private computeStringRangesForBox(boxMin: number, boxMax: number): { minFret: number; maxFret: number }[] {
    const { tuning } = this.props;
    const numStrings     = tuning.length;
    const isPenta        = this.isPentatonic();
    const isBlues        = this.props.mode === 9;
    const notesPerString = isPenta ? 2 : 3;

    // ── Stray-note detection (diatonic / blues only) ─────────────────────────
    // Pentatonic patterns skip this entirely — 2-note groups don't exhibit the
    // same G→B connector-note artefact as 3-note groups.
    //
    // Two situations cause a stray connector note at boxMin on B / high-e:
    //
    // 1. G cluster shifted right (gStartFret > boxMin):
    //    G has no note at boxMin; B/high-e may still have a scale note there
    //    that belongs to the previous pattern position.
    //
    // 2. G cluster extends beyond boxMax (gThirdFret > boxMax):
    //    Classic G→B tuning-break shift (major-third gap vs perfect-fourth).
    //    G's 3rd note lands past boxMax, so B and high-e must start 1 fret higher.
    //    Example: A Phrygian A-position — G has C(5), D(7), E(9) in box [5,8].
    //    E > boxMax 8 → drop the leading note on B and high-e.
    let skipStrayFromG = false;
    let bStartFret: number | null = null;   // null = stray detection not applicable

    if (!isPenta) {
      const gStringSi = numStrings - 1 - 2;
      const bStringSi = numStrings - 1 - 1;
      const gToB      = tuning[bStringSi] - tuning[gStringSi];

      // Only apply the stray-note correction when the G→B interval is the
      // standard major-third (4 semitones). If the user has retuned either
      // string the interval changes, the correction no longer applies, and
      // skipping it lets the natural note-search produce correct patterns.
      if (gToB === 4) {
        let gStartFret = boxMax + 2;
        let gThirdFret = boxMax + 2;
        let gCount     = 0;
        for (let f = boxMin; f <= boxMax + 2; f++) {
          if (this.isMarked(tuning[gStringSi] + f)) {
            if (gCount === 0) gStartFret = f;
            gCount++;
            if (gCount === 3) { gThirdFret = f; break; }
          }
        }
        const gExtended  = gCount >= 3 && gThirdFret > boxMax;
        skipStrayFromG   = (gStartFret > boxMin) || gExtended;

        let bFound = boxMax + 2;   // internal sentinel: "not found"
        for (let f = boxMin; f <= boxMax + 1; f++) {
          if (this.isMarked(tuning[bStringSi] + f)) { bFound = f; break; }
        }
        bStartFret = bFound;
      }
    }

    // Display order: row 0 = high e, row 1 = B, row 2 = G, …, row n-1 = low E
    const ranges: { minFret: number; maxFret: number }[] = [];
    for (let row = 0; row < numStrings; row++) {
      const si       = numStrings - 1 - row;
      const openNote = tuning[si];

      // For diatonic B (row 1) and high-e (row 0): collect an extra note and
      // search one fret further so that after stray-dropping we still have 3.
      // For pentatonic: collect exactly 2, search up to boxMax+7 to accommodate
      // strings whose 2-note group lands further right due to scale spacing.
      const isHighString = !isPenta && (row === 0 || row === 1);
      // Blues: cap at 3 (2 base + possible half-step extra); others: 2 or 3/4
      const maxCollect   = isPenta ? (isBlues ? 3 : 2) : (isHighString ? 4 : 3);
      const searchMax    = isPenta ? boxMax + 7 : (isHighString ? boxMax + 2 : boxMax + 1);

      const skipStrayAtBoxMin = row === 0
        ? (skipStrayFromG || (bStartFret !== null && bStartFret > boxMin))
        : skipStrayFromG;

      const marked: number[] = [];
      for (let f = boxMin; f <= searchMax && marked.length < maxCollect; f++) {
        if (this.isMarked(openNote + f)) {
          marked.push(f);
          // Blues: stop at 2 notes when the last interval is not a half step.
          // If it IS a half step, continue collecting up to the maxCollect cap (3).
          if (isBlues && marked.length === 2 && marked[1] - marked[0] > 1) break;
        }
      }

      if (!isPenta && isHighString && skipStrayAtBoxMin && marked.length > 0 && marked[0] === boxMin) {
        marked.shift();
      }

      // Pentatonic/blues: the loop already collected the right count — use as-is.
      // Diatonic: slice to notesPerString (handles post-stray-drop surplus).
      const used = isPenta ? marked : marked.slice(0, notesPerString);
      if (used.length > 0) {
        ranges.push({ minFret: used[0], maxFret: used[used.length - 1] });
      } else {
        ranges.push({ minFret: boxMin, maxFret: boxMax });
      }
    }
    return ranges;
  }

  private buildPatternPath(stringRanges: { minFret: number; maxFret: number }[]): string {
    const numRows    = stringRanges.length;
    const numStrings = this.props.tuning.length;
    const pad        = PAD;
    const { OPEN_W, NUT_W, FRET_W, ROW_H, HEADER_H } = this;

    const TOP_Y         = HEADER_H - pad;
    const BOT_Y         = HEADER_H + numStrings * ROW_H + pad;
    const rowBoundaryY  = (r: number) => HEADER_H + r * ROW_H;
    const xL = (fret: number) => OPEN_W + NUT_W + (fret - 1) * FRET_W - pad;
    const xR = (fret: number) => OPEN_W + NUT_W + fret * FRET_W + pad;

    const cmds: string[] = [];
    cmds.push(`M ${xL(stringRanges[0].minFret)} ${TOP_Y}`);
    cmds.push(`L ${xR(stringRanges[0].maxFret)} ${TOP_Y}`);

    // Right side: trace down, stepping horizontally where maxFret changes
    for (let r = 0; r < numRows; r++) {
      const nextY = r === numRows - 1 ? BOT_Y : rowBoundaryY(r + 1);
      cmds.push(`L ${xR(stringRanges[r].maxFret)} ${nextY}`);
      if (r < numRows - 1 && stringRanges[r].maxFret !== stringRanges[r + 1].maxFret) {
        cmds.push(`L ${xR(stringRanges[r + 1].maxFret)} ${nextY}`);
      }
    }

    cmds.push(`L ${xL(stringRanges[numRows - 1].minFret)} ${BOT_Y}`);

    // Left side: trace up, stepping horizontally where minFret changes
    for (let r = numRows - 1; r >= 0; r--) {
      const prevY = r === 0 ? TOP_Y : rowBoundaryY(r);
      cmds.push(`L ${xL(stringRanges[r].minFret)} ${prevY}`);
      if (r > 0 && stringRanges[r].minFret !== stringRanges[r - 1].minFret) {
        cmds.push(`L ${xL(stringRanges[r - 1].minFret)} ${prevY}`);
      }
    }

    cmds.push('Z');
    return cmds.join(' ');
  }

  computePositions(): PatternPosition[] {
    const { numOfFrets, tuning } = this.props;
    const numStrings = tuning.length;
    const isPenta    = this.isPentatonic();

    // Always anchor pattern boxes to the standard low-E string (tuning index
    // numStrings-6) so box boundaries are identical across 6/7/8-string layouts.
    // Extra bass strings below low E extend the display but don't shift the boxes.
    const refIdx  = Math.max(0, numStrings - 6);
    const refMidi = tuning[refIdx];

    // Build marked frets for the reference string
    const refFrets: number[] = [];
    for (let f = 1; f <= numOfFrets; f++) {
      if (this.isMarked(refMidi + f)) refFrets.push(f);
    }

    // Pentatonic: box = 2 consecutive marks (2 notes/string).
    // Diatonic / blues: box = 3 consecutive marks (3 notes/string).
    const boxSize = isPenta ? 2 : 3;
    if (refFrets.length < boxSize) return [];

    // Pentatonic positions are denser — allow them as close as 2 frets apart.
    const MIN_SEP = isPenta ? 2 : 3;
    const positions: PatternPosition[] = [];

    for (let i = 0; i <= refFrets.length - boxSize; i++) {
      const startFret = refFrets[i];
      const boxMin    = startFret;
      const boxMax    = refFrets[i + boxSize - 1];
      // For dedup: pentatonic uses startFret; diatonic uses the middle mark.
      const center    = isPenta ? startFret : refFrets[i + 1];

      if (positions.some(p => Math.abs(p.center - center) < MIN_SEP)) continue;

      const idx          = positions.length;
      const color        = PATTERN_COLORS[idx % PATTERN_COLORS.length];
      const label        = NoteNames.get(refMidi + startFret);
      const chipX        = ((boxMin - 1) + boxMax) / 2 * this.FRET_W;
      const stringRanges = this.computeStringRangesForBox(boxMin, boxMax);

      positions.push({ index: idx, center, label, color, boxMin, boxMax, chipX, stringRanges });
    }

    return positions;
  }

  cyclePattern(dir: 1 | -1) {
    const count = this.computePositions().length;
    if (count === 0) return;
    this.setState(s => {
      const next =
        s.soloPattern === null
          ? (dir === 1 ? 0 : count - 1)
          : (s.soloPattern + dir + count) % count;
      return { soloPattern: next };
    });
  }

  // ── Scale note computation ────────────────────────────────────────────────
  private computeScaleNotes(): { midiNote: number; stringIdx: number; fret: number }[] {
    const { soloPattern } = this.state;
    if (soloPattern === null) return [];
    const positions = this.computePositions();
    if (!positions.length || soloPattern >= positions.length) return [];
    const pos        = positions[soloPattern];
    const { tuning } = this.props;
    const numStrings = tuning.length;
    const notes: { midiNote: number; stringIdx: number; fret: number }[] = [];
    pos.stringRanges.forEach(({ minFret, maxFret }, row) => {
      const si = numStrings - 1 - row;
      for (let f = minFret; f <= maxFret; f++) {
        const midi = tuning[si] + f;
        if (this.isMarked(midi)) notes.push({ midiNote: midi, stringIdx: si, fret: f });
      }
    });
    notes.sort((a, b) => a.midiNote - b.midiNote);
    return notes;
  }

  // ── Scale playback scheduler ──────────────────────────────────────────────
  private scaleTick(): void {
    if (!this.scaleIsPlaying) return;
    const ctx    = this.props.guitarService.audioContext;
    const { scaleBpm, scaleNoteLen, scaleTimeSig } = this.state;
    const ts     = scaleTimeSig;
    const qnSec  = 60 / scaleBpm;
    const beatSec = ts.beatDurQN * qnSec;
    const noteQN  = scaleNoteLen === 'whole' ? ts.beats * ts.beatDurQN : NOTE_LENGTH_BEATS[scaleNoteLen];
    const noteSec = noteQN * qnSec;
    const relSec  = Math.min(noteSec * 0.7, 1.5);
    const notes   = this.cachedScaleNotes;
    if (!notes.length) return;

    while (this.scaleNextBeatT < ctx.currentTime + LOOKAHEAD_S) {
      const bi = this.scaleNextBeatIdx;
      const t  = this.scaleNextBeatT;
      const ms = Math.max((t - ctx.currentTime) * 1000, 0);
      const tm = window.setTimeout(() => {
        if (this.scaleIsPlaying) this.setState({ scaleBeat: bi });
      }, ms);
      this.scaleUiTimers.push(tm);
      this.scaleNextBeatT    += beatSec;
      this.scaleNextBeatIdx   = (bi + 1) % ts.beats;
    }

    while (this.scaleNextNoteT < ctx.currentTime + LOOKAHEAD_S) {
      const ni   = this.scaleNextNoteIdx;
      const note = notes[ni];
      this.props.guitarService.playNoteAt(
        note.midiNote, this.props.soundMode,
        this.scaleNextNoteT, noteSec, relSec,
      );
      const t  = this.scaleNextNoteT;
      const ms = Math.max((t - ctx.currentTime) * 1000, 0);
      const tm = window.setTimeout(() => {
        if (this.scaleIsPlaying)
          this.setState({ activeNote: { stringIdx: note.stringIdx, fret: note.fret } });
      }, ms);
      this.scaleUiTimers.push(tm);
      this.scaleNextNoteT    += noteSec;
      this.scaleNextNoteIdx   = (ni + 1) % notes.length;
    }
  }

  private startScalePlay(): void {
    this.stopScalePlay();
    const notes = this.computeScaleNotes();
    if (!notes.length) return;
    this.cachedScaleNotes = notes;
    this.props.guitarService.audioContext.resume().then(() => {
      const t0 = this.props.guitarService.audioContext.currentTime + 0.05;
      this.scaleNextNoteT   = t0;
      this.scaleNextBeatT   = t0;
      this.scaleNextNoteIdx = 0;
      this.scaleNextBeatIdx = 0;
      this.scaleIsPlaying   = true;
      this.scaleTick();
      this.scaleIntervalId = window.setInterval(() => this.scaleTick(), TICK_MS);
      this.setState({ isPlayingScale: true, scaleBeat: 0, activeNote: null });
    });
  }

  private stopScalePlay(): void {
    this.scaleIsPlaying = false;
    if (this.scaleIntervalId !== null) {
      clearInterval(this.scaleIntervalId);
      this.scaleIntervalId = null;
    }
    this.scaleUiTimers.forEach(clearTimeout);
    this.scaleUiTimers = [];
    this.setState({ isPlayingScale: false, activeNote: null, scaleBeat: -1 });
  }

  private isNotePlaying(stringIdx: number, fret: number): boolean {
    const { isPlayingScale, activeNote } = this.state;
    if (!isPlayingScale || !activeNote) return false;
    return activeNote.stringIdx === stringIdx && activeNote.fret === fret;
  }

  render() {
    const { numOfFrets, keySig, tuning, soundMode, guitarService, showPattern } = this.props;
    const { soloPattern, isPlayingScale, scaleBeat, scaleTimeSig, scaleBpm, scaleNoteLen, synced, showScaleControls } = this.state;
    const numStrings = tuning.length;
    const fretNums   = Array.from({ length: numOfFrets }, (_, i) => i + 1);
    const stringOrder = Array.from({ length: numStrings }, (_, i) => numStrings - 1 - i);

    const { OPEN_W, NUT_W, FRET_W, ROW_H, HEADER_H } = this;
    const svgWidth  = OPEN_W + NUT_W + numOfFrets * FRET_W;
    const svgHeight = HEADER_H + numStrings * ROW_H + HEADER_H;

    const positions = showPattern ? this.computePositions() : [];

    const fretboardEl = (
      <div className="fretboard">

        {/* ── Pattern overlay ─────────────────────────────────────────── */}
        {showPattern && (
          <svg
            className="fb-pattern-overlay"
            width={svgWidth}
            height={svgHeight}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 3 }}
          >
            {positions.map(({ index: j, color, stringRanges }) => {
              const dimmed = soloPattern !== null && soloPattern !== j;
              const d = this.buildPatternPath(stringRanges);
              return (
                <path key={j}
                  d={d}
                  fill={color.fill}
                  fillOpacity={dimmed ? 0 : 1}
                  stroke={color.stroke}
                  strokeWidth="2"
                  strokeOpacity={dimmed ? 0.12 : 0.85}
                  strokeLinejoin="miter"
                />
              );
            })}
          </svg>
        )}

        {/* ── Fret-number header ──────────────────────────────────────── */}
        <div className="fb-header-row">
          <div className="fb-open-spacer" />
          <div className="fb-nut-spacer" />
          {fretNums.map(f => (
            <div key={f} className={`fb-fret-num${INLAY_FRETS.has(f) ? ' has-inlay' : ''}${DBL_INLAY_FRETS.has(f) ? ' is-octave' : ''}`}>{f}</div>
          ))}
        </div>

        {/* ── String rows ─────────────────────────────────────────────── */}
        {stringOrder.map(si => {
          const openNote   = tuning[si];
          const gaugeIndex = si + 1;
          return (
            <div key={si} className={`fb-string-row fb-gauge-${gaugeIndex}`}>
              <div className="fb-fret-cell fb-open-cell">
                {/* Always-visible string name so you can orient yourself at a glance */}
                <span className="fb-string-label">{NoteNames.get(openNote)}</span>
                <Note value={openNote} marked={this.isMarked(openNote)} keySig={keySig}
                  guitarService={guitarService} soundMode={soundMode} showPattern={showPattern}
                  playing={this.isNotePlaying(si, 0)} />
              </div>
              <div className="fb-nut-bar" />
              {fretNums.map(fi => {
                const midiNote = openNote + fi;
                const inlayCls = INLAY_FRETS.has(fi)
                  ? (DBL_INLAY_FRETS.has(fi) ? ' fb-inlay-col fb-inlay-col--oct' : ' fb-inlay-col')
                  : '';
                return (
                  <div key={fi} className={`fb-fret-cell${inlayCls}`}>
                    <Note value={midiNote} marked={this.isMarked(midiNote)} keySig={keySig}
                      guitarService={guitarService} soundMode={soundMode} showPattern={showPattern}
                      playing={this.isNotePlaying(si, fi)} />
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* ── Inlay-marker row — dots + fret numbers for quick navigation ─ */}
        <div className="fb-inlay-row">
          <div className="fb-open-spacer" />
          <div className="fb-nut-spacer" />
          {fretNums.map(f => (
            <div key={f} className={`fb-inlay-cell${INLAY_FRETS.has(f) ? ' has-inlay' : ''}${DBL_INLAY_FRETS.has(f) ? ' is-octave' : ''}`}>
              {INLAY_FRETS.has(f) && (
                <>
                  <div className="fb-inlay-dots">
                    <span className="fb-inlay-dot" />
                    {DBL_INLAY_FRETS.has(f) && <span className="fb-inlay-dot" />}
                  </div>
                  <span className="fb-inlay-label">{f}</span>
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Pattern legend ──────────────────────────────────────────── */}
        {showPattern && positions.length > 0 && (
          <div className="fb-pattern-legend">

            {/* Prev / Next cycle arrows */}
            <div className="fb-legend-nav">
              <button className="fb-legend-arrow" onClick={() => this.cyclePattern(-1)}
                title="Previous pattern">&#8249;</button>
              <button className="fb-legend-arrow" onClick={() => this.cyclePattern(1)}
                title="Next pattern">&#8250;</button>
            </div>

            {/* Nut spacer so chips align with fret columns */}
            <div className="fb-nut-spacer" />

            {/* Chips — absolutely positioned over their box's center */}
            <div className="fb-legend-chips">
              {positions.map(({ index: j, label, color, chipX }) => {
                const isSolo   = soloPattern === j;
                const isDimmed = soloPattern !== null && !isSolo;
                return (
                  <button
                    key={j}
                    className={`fb-pattern-chip${isSolo ? ' solo' : ''}${isDimmed ? ' dimmed' : ''}`}
                    style={{
                      left:        chipX,
                      borderColor: color.stroke,
                      color:       isSolo ? '#0d1117' : color.stroke,
                      background:  isSolo ? color.stroke : 'rgba(13,17,23,0.7)',
                    }}
                    onClick={() => this.setState(s => ({
                      soloPattern: s.soloPattern === j ? null : j,
                    }))}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>
    );

    // ── Scale Playback Controls — portaled outside the scroll container ──────
    const { scaleCtrlRoot } = this.state;
    const scaleCtrl = (
      <div className="fb-scale-ctrl">

        {/* Always-visible row: title · beat dots · play · sync · expand */}
        <div className="fb-scale-top-row">
          <span className="fb-scale-title">Scale Playback</span>
          <div className="fb-scale-beats">
            {Array.from({ length: scaleTimeSig.beats }, (_, b) => (
              <span key={b}
                    className={`fb-scale-beat${isPlayingScale && scaleBeat === b ? ' fb-scale-beat--on' : ''}`} />
            ))}
          </div>
          <button
            className={`fb-scale-play${isPlayingScale ? ' fb-scale-play--playing' : ''}`}
            onClick={() => isPlayingScale ? this.stopScalePlay() : this.startScalePlay()}
            disabled={soloPattern === null}
            aria-label={isPlayingScale ? 'Stop scale' : 'Play scale'}
          >
            {isPlayingScale ? '■' : '▶'}
          </button>
          <button
            className={`fb-scale-sync-btn${synced ? ' fb-scale-sync-btn--active' : ''}`}
            onClick={() => this.setState({
              synced: true,
              scaleBpm: this.props.bpm,
              scaleTimeSig: this.props.timeSig,
              scaleNoteLen: this.props.noteLength,
            })}
            title={synced ? 'Synced with Global Playback' : 'Sync with Global Playback'}
            aria-label="Sync with global playback"
          >
            {synced ? '⟳ Synced' : '⟳ Sync'}
          </button>
          <button
            className="fb-scale-more-btn"
            onClick={() => this.setState(s => ({ showScaleControls: !s.showScaleControls }))}
            title={showScaleControls ? 'Hide scale controls' : 'Show scale controls'}
            aria-label={showScaleControls ? 'Hide scale controls' : 'Show scale controls'}
          >
            {showScaleControls ? '▲' : '▼'}
          </button>
        </div>

        {/* Collapsible: BPM / note length / time sig */}
        {showScaleControls && (
          <>
            <div className="fb-scale-controls-row">
              <div className="fb-scale-bpm-group">
                <label className="fb-scale-label">BPM</label>
                <input type="range" className="fb-scale-bpm-slider"
                       min={40} max={240} step={1} value={scaleBpm}
                       onChange={e => this.setState({ scaleBpm: +e.currentTarget.value, synced: false })} />
                <span className="fb-scale-bpm-value">{scaleBpm}</span>
              </div>
              <div className="fb-scale-nl-group">
                {NOTE_LENGTH_OPTIONS.map(nl => (
                  <button key={nl}
                          className={`fb-scale-nl-btn${scaleNoteLen === nl ? ' fb-scale-nl-btn--active' : ''}`}
                          onClick={() => this.setState({ scaleNoteLen: nl, synced: false })}>
                    {NOTE_LENGTH_LABEL[nl]}
                  </button>
                ))}
              </div>
            </div>

            <div className="fb-scale-ts-row">
              {TIME_SIG_GROUPS.map((group, gi) => (
                <div key={gi} className="fb-scale-ts-group">
                  <span className="fb-scale-ts-category">{group.category}</span>
                  <div className="fb-scale-ts-btns">
                    {group.sigs.map(ts => (
                      <button key={ts.label}
                              className={`fb-scale-ts-btn${scaleTimeSig.label === ts.label ? ' fb-scale-ts-btn--active' : ''}`}
                              onClick={() => this.setState({ scaleTimeSig: ts, synced: false })}
                              title={`${ts.beats} beat${ts.beats !== 1 ? 's' : ''} per measure`}>
                        {ts.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    );

    return (
      <>
        {fretboardEl}
        {scaleCtrl && scaleCtrlRoot
          ? ReactDOM.createPortal(scaleCtrl, scaleCtrlRoot)
          : scaleCtrl}
      </>
    );
  }
}
