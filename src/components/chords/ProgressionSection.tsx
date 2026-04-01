import React, { useState, useRef, useCallback, useEffect } from 'react';
import './ProgressionSection.css';
import { ChordDiagram } from './ChordDiagram';
import { COMMON_PROGRESSIONS, getProgressionChords } from '../../models/chords';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IProgressionSection {
    keySig:        number;
    tuning:        number[];
    guitarService: GuitarService;
    soundMode:     SoundMode;
}

/* ── Note length ──────────────────────────────────────────────────────────── */

type NoteLength = 'sixteenth' | 'eighth' | 'quarter' | 'half' | 'whole';

/**
 * Duration of each chord in time-signature BEATS (not quarter notes).
 * 'whole' is not listed here — it is computed at runtime as ts.beats
 * so it always spans exactly one full measure regardless of time signature.
 */
const NOTE_LENGTH_BEATS: Record<Exclude<NoteLength, 'whole'>, number> = {
    sixteenth: 0.25,
    eighth:    0.50,
    quarter:   1.00,
    half:      2.00,
};

const NOTE_LENGTH_OPTIONS: NoteLength[] = ['sixteenth', 'eighth', 'quarter', 'half', 'whole'];
const NOTE_LENGTH_LABEL:   Record<NoteLength, string> = {
    sixteenth: '1/16',
    eighth:    '1/8',
    quarter:   '1/4',
    half:      '1/2',
    whole:     '1/1',
};

/* ── Time signature ───────────────────────────────────────────────────────── */

interface TimeSig {
    label:      string;
    beats:      number;   // beat-dot count per measure
    beatDurQN:  number;   // duration of one beat, expressed in quarter notes
}

/**
 * BPM always refers to quarter-note beats per minute.
 * beatDurQN encodes how many quarter notes constitute one beat in this
 * time signature, so the scheduler can convert BPM → seconds per beat.
 *
 *   e.g. 6/8: one beat = dotted quarter = 1.5 quarter notes → beatDurQN 1.5
 *        2/2: one beat = half note       = 2   quarter notes → beatDurQN 2.0
 *        7/8: one beat = eighth note     = 0.5 quarter notes → beatDurQN 0.5
 */
const TIME_SIG_GROUPS: { category: string; sigs: TimeSig[] }[] = [
    {
        category: 'Simple',
        sigs: [
            { label: '4/4',  beats: 4, beatDurQN: 1.0 },
            { label: 'C',    beats: 4, beatDurQN: 1.0 },
            { label: '2/2',  beats: 2, beatDurQN: 2.0 },
            { label: '2/4',  beats: 2, beatDurQN: 1.0 },
            { label: '3/4',  beats: 3, beatDurQN: 1.0 },
        ],
    },
    {
        category: 'Compound',
        sigs: [
            { label: '6/8',  beats: 2, beatDurQN: 1.5 },
            { label: '9/8',  beats: 3, beatDurQN: 1.5 },
            { label: '12/8', beats: 4, beatDurQN: 1.5 },
            { label: '3/8',  beats: 1, beatDurQN: 1.5 },
        ],
    },
    {
        category: 'Irregular',
        sigs: [
            { label: '5/4',  beats: 5, beatDurQN: 1.0 },
            { label: '7/4',  beats: 7, beatDurQN: 1.0 },
            { label: '7/8',  beats: 7, beatDurQN: 0.5 },
        ],
    },
];

const ALL_TIME_SIGS   = TIME_SIG_GROUPS.flatMap(g => g.sigs);
const DEFAULT_TIME_SIG: TimeSig = ALL_TIME_SIGS[0]; // 4/4

/* ── Scheduler constants ──────────────────────────────────────────────────── */

const DEFAULT_BPM        = 110;
const DEFAULT_NOTE_LEN: NoteLength = 'whole';

const STRUM_SPREAD = 0.026;  // seconds between successive strings in a strum
const LOOKAHEAD_S  = 0.30;   // how far ahead to schedule audio events
const TICK_MS      = 100;    // scheduler polling interval (ms)

/* ═══════════════════════════════════════════════════════════════════════════ */

export function ProgressionSection({ keySig, tuning, guitarService, soundMode }: IProgressionSection) {

    const [currentIdx,  setCurrentIdx]  = useState(0);
    const [isPlaying,   setIsPlaying]   = useState(false);
    const [activeChord, setActiveChord] = useState(-1);
    const [activeBeat,  setActiveBeat]  = useState(-1);
    const [bpm,         setBpm]         = useState(DEFAULT_BPM);
    const [noteLength,  setNoteLength]  = useState<NoteLength>(DEFAULT_NOTE_LEN);
    const [timeSig,     setTimeSig]     = useState<TimeSig>(DEFAULT_TIME_SIG);

    const total = COMMON_PROGRESSIONS.length;
    const prog  = COMMON_PROGRESSIONS[currentIdx];

    /* ── Scheduler refs ───────────────────────────────────────────────── */
    const schedulerRef     = useRef<number | null>(null);
    const isPlayingRef     = useRef(false);
    const chordsRef        = useRef<ReturnType<typeof getProgressionChords>>([]);
    const nextChordTimeRef = useRef(0);
    const nextBeatTimeRef  = useRef(0);
    const nextChordRef     = useRef(0);
    const nextBeatDotRef   = useRef(0);
    const uiTimersRef      = useRef<number[]>([]);

    // Mirror mutable state into refs so the scheduler closure always reads
    // the latest values without needing to be recreated.
    const bpmRef        = useRef(DEFAULT_BPM);
    const noteLenRef    = useRef<NoteLength>(DEFAULT_NOTE_LEN);
    const timeSigRef    = useRef<TimeSig>(DEFAULT_TIME_SIG);

    useEffect(() => { bpmRef.current     = bpm;       }, [bpm]);
    useEffect(() => { noteLenRef.current = noteLength; }, [noteLength]);
    useEffect(() => { timeSigRef.current = timeSig;   }, [timeSig]);

    /* ── Main scheduler tick ──────────────────────────────────────────── */
    const tickRef = useRef<() => void>(() => {});
    useEffect(() => {
        tickRef.current = () => {
            if (!isPlayingRef.current) return;

            const ctx    = guitarService.audioContext;
            const chords = chordsRef.current;
            const ts     = timeSigRef.current;

            const qnSec      = 60 / bpmRef.current;
            const beatSec    = ts.beatDurQN * qnSec;
            // One full measure in seconds
            const measureSec = ts.beats * beatSec;

            // Each strum's duration in QN; 'whole' fills exactly one measure
            const strumQN  = noteLenRef.current === 'whole'
                ? ts.beats * ts.beatDurQN
                : NOTE_LENGTH_BEATS[noteLenRef.current];
            const strumSec   = strumQN * qnSec;
            // How many strums fit in one measure (= chord duration)
            const numStrums  = Math.max(1, Math.round(measureSec / strumSec));
            const releaseSec = Math.min(strumSec * 0.5, 2.0);

            // ── Beat dots: pulse once per time-sig beat ────────────────
            while (nextBeatTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const bi      = nextBeatDotRef.current;
                const t       = nextBeatTimeRef.current;
                const delayMs = Math.max((t - ctx.currentTime) * 1000, 0);
                const timer   = window.setTimeout(() => setActiveBeat(bi), delayMs);
                uiTimersRef.current.push(timer);
                nextBeatTimeRef.current   += beatSec;
                nextBeatDotRef.current     = (bi + 1) % ts.beats;
            }

            // ── Chord changes: one chord per measure, strummed numStrums times ──
            while (nextChordTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const ci           = nextChordRef.current;
                const measureStart = nextChordTimeRef.current;

                // Schedule each strum within this measure
                for (let s = 0; s < numStrums; s++) {
                    const strumTime = measureStart + s * strumSec;
                    chords[ci].voicing.forEach((fret, si) => {
                        if (fret !== null) {
                            guitarService.playNoteAt(
                                tuning[si] + fret, soundMode,
                                strumTime + si * STRUM_SPREAD,
                                strumSec,
                                releaseSec,
                            );
                        }
                    });
                }

                const delayMs = Math.max((measureStart - ctx.currentTime) * 1000, 0);
                const timer   = window.setTimeout(() => setActiveChord(ci), delayMs);
                uiTimersRef.current.push(timer);

                nextChordTimeRef.current += measureSec;
                nextChordRef.current      = (ci + 1) % chords.length;
            }
        };
    }, [guitarService, tuning, soundMode]);

    /* ── Teardown / stop ──────────────────────────────────────────────── */
    const teardown = useCallback(() => {
        isPlayingRef.current = false;
        if (schedulerRef.current !== null) {
            clearInterval(schedulerRef.current);
            schedulerRef.current = null;
        }
        uiTimersRef.current.forEach(clearTimeout);
        uiTimersRef.current = [];
    }, []);

    const stop = useCallback(() => {
        teardown();
        setIsPlaying(false);
        setActiveChord(-1);
        setActiveBeat(-1);
    }, [teardown]);

    useEffect(() => () => teardown(), [teardown]);

    /* ── Play ─────────────────────────────────────────────────────────── */
    const play = useCallback((progIdx: number) => {
        teardown();

        const chords = getProgressionChords(keySig, COMMON_PROGRESSIONS[progIdx], tuning);
        if (!chords.length) return;

        guitarService.audioContext.resume().then(() => {
            const ctx = guitarService.audioContext;
            const t0  = ctx.currentTime + 0.05;

            chordsRef.current        = chords;
            nextChordTimeRef.current = t0;
            nextBeatTimeRef.current  = t0;
            nextChordRef.current     = 0;
            nextBeatDotRef.current   = 0;
            isPlayingRef.current     = true;

            tickRef.current();
            schedulerRef.current = window.setInterval(() => tickRef.current(), TICK_MS);

            setIsPlaying(true);
            setActiveChord(0);
            setActiveBeat(0);
        });
    }, [keySig, tuning, guitarService, teardown]);

    const navigate = useCallback((delta: number) => {
        if (isPlaying) stop();
        setCurrentIdx(i => (i + delta + total) % total);
    }, [isPlaying, stop, total]);

    const chords = getProgressionChords(keySig, prog, tuning);

    /* ── Render ───────────────────────────────────────────────────────── */
    return (
        <div className="progression-section">
            <div className="progression-header">

                {/* Row 1: prev / name+genre / next / beat-dots / play */}
                <div className="prog-nav-row">
                    <button className="prog-nav-btn" onClick={() => navigate(-1)} aria-label="Previous">&#8249;</button>

                    <div className="prog-info">
                        <span className="prog-name">{prog.name}</span>
                        <span className="prog-genre">{prog.genre}</span>
                    </div>

                    <button className="prog-nav-btn" onClick={() => navigate(1)} aria-label="Next">&#8250;</button>

                    {/* Beat dots — count matches time-sig beats per measure */}
                    <div className="prog-beats">
                        {Array.from({ length: timeSig.beats }, (_, b) => (
                            <span
                                key={b}
                                className={`prog-beat${isPlaying && activeBeat === b ? ' prog-beat--on' : ''}`}
                            />
                        ))}
                    </div>

                    <button
                        className={`prog-play-btn${isPlaying ? ' prog-play-btn--playing' : ''}`}
                        onClick={() => isPlaying ? stop() : play(currentIdx)}
                        aria-label={isPlaying ? 'Stop' : 'Play'}
                    >
                        {isPlaying ? '■' : '▶'}
                    </button>
                </div>

                {/* Row 2: BPM + note-length */}
                <div className="prog-controls-row">
                    <div className="prog-bpm-group">
                        <label className="prog-ctrl-label">BPM</label>
                        <input
                            type="range"
                            className="prog-bpm-slider"
                            min={40} max={240} step={1}
                            value={bpm}
                            onChange={e => setBpm(+e.currentTarget.value)}
                        />
                        <span className="prog-bpm-value">{bpm}</span>
                    </div>

                    <div className="prog-note-length-group">
                        {NOTE_LENGTH_OPTIONS.map(nl => (
                            <button
                                key={nl}
                                className={`prog-nl-btn${noteLength === nl ? ' prog-nl-btn--active' : ''}`}
                                onClick={() => setNoteLength(nl)}
                            >
                                {NOTE_LENGTH_LABEL[nl]}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Row 3: Time signature — grouped by category */}
                <div className="prog-timesig-row">
                    {TIME_SIG_GROUPS.map((group, gi) => (
                        <div key={gi} className="prog-timesig-group">
                            <span className="prog-timesig-category">{group.category}</span>
                            <div className="prog-timesig-btns">
                                {group.sigs.map(ts => (
                                    <button
                                        key={ts.label}
                                        className={`prog-ts-btn${timeSig.label === ts.label ? ' prog-ts-btn--active' : ''}`}
                                        onClick={() => setTimeSig(ts)}
                                        title={`${ts.beats} beat${ts.beats !== 1 ? 's' : ''} per measure`}
                                    >
                                        {ts.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Pagination dots */}
                <div className="prog-dots">
                    {COMMON_PROGRESSIONS.map((_, i) => (
                        <button
                            key={i}
                            className={`prog-dot${i === currentIdx ? ' prog-dot--active' : ''}`}
                            onClick={() => { if (isPlaying) stop(); setCurrentIdx(i); }}
                            aria-label={`Progression ${i + 1}`}
                        />
                    ))}
                </div>
            </div>

            <div className="prog-card-chords">
                {chords.map((chord, ci) => (
                    <div
                        key={ci}
                        className={`chord-slot${isPlaying && activeChord === ci ? ' chord-slot--active' : ''}`}
                    >
                        <ChordDiagram
                            chord={chord}
                            tuning={tuning}
                            guitarService={guitarService}
                            soundMode={soundMode}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
