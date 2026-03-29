import React from 'react';
import { Note } from '../note/Note';
import './Fretboard.css';
import { Modes } from '../../models/modes';
import { NoteNames } from '../../models/noteNames';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IFretboard {
  numOfFrets: number;
  keySig: number;
  mode: number;
  tuning: number[];
  soundMode: SoundMode;
  guitarService: GuitarService;
  showPattern: boolean;
}

interface FretboardState {
  soloPattern: number | null;
}

const INLAY_FRETS     = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21]);
const DBL_INLAY_FRETS = new Set([12]);

const OPEN_W   = 52;
const NUT_W    = 14;
const FRET_W   = 52;
const ROW_H    = 64;
const HEADER_H = 26;
const PAD      = 6;

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
}

export class Fretboard extends React.Component<IFretboard, FretboardState> {

  constructor(props: IFretboard) {
    super(props);
    this.state = { soloPattern: null };
  }

  componentDidMount() {
    if (this.props.showPattern) this.selectKeyPattern();
  }

  componentDidUpdate(prevProps: IFretboard) {
    const { showPattern, keySig, mode } = this.props;
    if (!prevProps.showPattern && showPattern) {
      this.selectKeyPattern();
    } else if (prevProps.showPattern && !showPattern) {
      this.setState({ soloPattern: null });
    } else if (showPattern && (prevProps.keySig !== keySig || prevProps.mode !== mode)) {
      this.selectKeyPattern();
    }
  }

  private selectKeyPattern() {
    const positions = this.computePositions();
    const keyLabel  = NoteNames.get(this.props.keySig);
    const idx       = positions.findIndex(p => p.label === keyLabel);
    this.setState({ soloPattern: idx >= 0 ? idx : null });
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

  computePositions(): PatternPosition[] {
    const { numOfFrets, tuning } = this.props;
    const numStrings = tuning.length;

    const markedByString: number[][] = Array.from({ length: numStrings }, (_, si) => {
      const openNote = tuning[si];
      const frets: number[] = [];
      for (let f = 1; f <= numOfFrets; f++) {
        if (this.isMarked(openNote + f)) frets.push(f);
      }
      return frets;
    });

    const refFrets = markedByString[0];
    if (refFrets.length < 3) return [];

    const MIN_SEP = 3;
    const positions: PatternPosition[] = [];

    for (let i = 0; i <= refFrets.length - 3; i++) {
      const startFret = refFrets[i];
      const center    = refFrets[i + 1];

      if (positions.some(p => Math.abs(p.center - center) < MIN_SEP)) continue;

      // Per-string: find the 3-note group whose middle note is nearest to center
      let boxMin = Infinity, boxMax = -Infinity;
      for (const frets of markedByString) {
        if (frets.length < 3) continue;
        let bestDist = Infinity, bestA = frets[0], bestC = frets[2];
        for (let k = 0; k <= frets.length - 3; k++) {
          const dist = Math.abs(frets[k + 1] - center);
          if (dist < bestDist) { bestDist = dist; bestA = frets[k]; bestC = frets[k + 2]; }
        }
        boxMin = Math.min(boxMin, bestA);
        boxMax = Math.max(boxMax, bestC);
      }
      if (boxMin === Infinity) continue;

      const idx   = positions.length;
      const color = PATTERN_COLORS[idx % PATTERN_COLORS.length];
      const label = NoteNames.get(tuning[0] + startFret);
      // chip center = pixel-center of the box, relative to the fret-area div
      const chipX = ((boxMin - 1) + boxMax) / 2 * FRET_W;

      positions.push({ index: idx, center, label, color, boxMin, boxMax, chipX });
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

  render() {
    const { numOfFrets, keySig, tuning, soundMode, guitarService, showPattern } = this.props;
    const { soloPattern } = this.state;
    const numStrings = tuning.length;
    const fretNums   = Array.from({ length: numOfFrets }, (_, i) => i + 1);
    const stringOrder = Array.from({ length: numStrings }, (_, i) => numStrings - 1 - i);

    const svgWidth  = OPEN_W + NUT_W + numOfFrets * FRET_W;
    const svgHeight = HEADER_H + numStrings * ROW_H + HEADER_H;

    const positions = showPattern ? this.computePositions() : [];

    return (
      <div className="fretboard">

        {/* ── Pattern overlay ─────────────────────────────────────────── */}
        {showPattern && (
          <svg
            className="fb-pattern-overlay"
            width={svgWidth}
            height={svgHeight}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 3 }}
          >
            {positions.map(({ index: j, color, boxMin, boxMax }) => {
              const dimmed = soloPattern !== null && soloPattern !== j;
              const x1 = OPEN_W + NUT_W + (boxMin - 1) * FRET_W - PAD;
              const x2 = OPEN_W + NUT_W + boxMax * FRET_W + PAD;
              const y1 = HEADER_H - PAD;
              const y2 = HEADER_H + numStrings * ROW_H + PAD;
              return (
                <rect key={j}
                  x={x1} y={y1} width={x2 - x1} height={y2 - y1}
                  rx={8} ry={8}
                  fill={color.fill}
                  fillOpacity={dimmed ? 0 : 1}
                  stroke={color.stroke}
                  strokeWidth="2"
                  strokeOpacity={dimmed ? 0.12 : 0.85}
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
            <div key={f} className={`fb-fret-num${INLAY_FRETS.has(f) ? ' has-inlay' : ''}`}>{f}</div>
          ))}
        </div>

        {/* ── String rows ─────────────────────────────────────────────── */}
        {stringOrder.map(si => {
          const openNote   = tuning[si];
          const gaugeIndex = si + 1;
          return (
            <div key={si} className={`fb-string-row fb-gauge-${gaugeIndex}`}>
              <div className="fb-fret-cell fb-open-cell">
                <Note value={openNote} marked={this.isMarked(openNote)} keySig={keySig}
                  guitarService={guitarService} soundMode={soundMode} showPattern={showPattern} />
              </div>
              <div className="fb-nut-bar" />
              {fretNums.map(fi => {
                const midiNote = openNote + fi;
                return (
                  <div key={fi} className="fb-fret-cell">
                    <Note value={midiNote} marked={this.isMarked(midiNote)} keySig={keySig}
                      guitarService={guitarService} soundMode={soundMode} showPattern={showPattern} />
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* ── Inlay-marker row ────────────────────────────────────────── */}
        <div className="fb-inlay-row">
          <div className="fb-open-spacer" />
          <div className="fb-nut-spacer" />
          {fretNums.map(f => (
            <div key={f} className="fb-inlay-cell">
              {INLAY_FRETS.has(f) && (
                <>
                  <span className="fb-inlay-dot" />
                  {DBL_INLAY_FRETS.has(f) && <span className="fb-inlay-dot" />}
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
  }
}
