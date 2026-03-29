import React from 'react';
import { Note } from '../note/Note';
import './Fretboard.css';
import { Modes } from '../../models/modes';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IFretboard {
  numOfFrets: number;
  keySig: number;
  mode: number;
  tuning: number[];
  soundMode: SoundMode;
  guitarService: GuitarService;
}

const INLAY_FRETS     = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21]);
const DBL_INLAY_FRETS = new Set([12]);

export class Fretboard extends React.Component<IFretboard> {

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

  render() {
    const { numOfFrets, keySig, tuning, soundMode, guitarService } = this.props;
    const numStrings  = tuning.length;
    const fretNums    = Array.from({ length: numOfFrets }, (_, i) => i + 1); // 1..numOfFrets

    // Render high string (index n-1) at top, low string (index 0) at bottom
    const stringOrder = Array.from({ length: numStrings }, (_, i) => numStrings - 1 - i);

    return (
      <div className="fretboard">

        {/* ── Fret-number header ─────────────────────────────────────────── */}
        <div className="fb-header-row">
          <div className="fb-open-spacer" />
          <div className="fb-nut-spacer"  />
          {fretNums.map(f => (
            <div key={f} className={`fb-fret-num${INLAY_FRETS.has(f) ? ' has-inlay' : ''}`}>{f}</div>
          ))}
        </div>

        {/* ── String rows ────────────────────────────────────────────────── */}
        {stringOrder.map(si => {
          const openNote   = tuning[si];
          // gaugeIndex 1 = thinnest (high e), numStrings = thickest (low E)
          const gaugeIndex = si + 1;

          return (
            <div key={si} className={`fb-string-row fb-gauge-${gaugeIndex}`}>
              {/* Open-string cell */}
              <div className="fb-fret-cell fb-open-cell">
                <Note
                  value={ openNote }
                  marked={ this.isMarked(openNote) }
                  keySig={ keySig }
                  guitarService={ guitarService }
                  soundMode={ soundMode }
                />
              </div>

              {/* Nut */}
              <div className="fb-nut-bar" />

              {/* Fretted cells */}
              {fretNums.map(fi => {
                const midiNote = openNote + fi;
                return (
                  <div key={fi} className="fb-fret-cell">
                    <Note
                      value={ midiNote }
                      marked={ this.isMarked(midiNote) }
                      keySig={ keySig }
                      guitarService={ guitarService }
                      soundMode={ soundMode }
                    />
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* ── Inlay-marker row ───────────────────────────────────────────── */}
        <div className="fb-inlay-row">
          <div className="fb-open-spacer" />
          <div className="fb-nut-spacer"  />
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

      </div>
    );
  }
}
