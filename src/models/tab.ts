import { NoteLength, TimeSig, DEFAULT_TIME_SIG } from './playback';

/** Bend amount in semitones: 1 = half-step, 2 = full, 3 = full+half, 4 = two-full */
export type BendAmount = 1 | 2 | 3 | 4;

/** How a note is arrived at from the previous note on the same string. */
export type Articulation = 'hammer' | 'pulloff' | 'slide-up' | 'slide-down';

export interface TabNote {
  stringIdx:     number;
  fret:          number;
  muted?:        boolean;
  bend?:         BendAmount;
  articulation?: Articulation;
  palmMuted?:    boolean;
  vibrato?:      boolean;
  harmonic?:     boolean;
}

export interface TabColumn {
  id:         string;
  noteLength: NoteLength;
  isRest?:    boolean;
  notes:      TabNote[];
}

export interface TabBar {
  id:      string;
  timeSig: TimeSig;
  columns: TabColumn[];
}

export interface TabDocument {
  version: 1;
  bpm:     number;
  bars:    TabBar[];
}

let _idCounter = 0;
export function newId(): string { return String(++_idCounter); }

export function makeColumn(noteLength: NoteLength = 'quarter', isRest = false): TabColumn {
  return { id: newId(), noteLength, isRest: isRest || undefined, notes: [] };
}

export function makeBar(timeSig: TimeSig = DEFAULT_TIME_SIG, initialNoteLength: NoteLength = 'quarter'): TabBar {
  return { id: newId(), timeSig, columns: [makeColumn(initialNoteLength)] };
}
