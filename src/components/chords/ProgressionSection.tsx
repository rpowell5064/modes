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

const BPM          = 82;
const BEAT_DUR     = 60 / BPM;
const STRUM_SPREAD = 0.026;
const NOTE_DUR     = BEAT_DUR * 0.66;
const LOOKAHEAD_S  = 0.30;
const TICK_MS      = 100;

export function ProgressionSection({ keySig, tuning, guitarService, soundMode }: IProgressionSection) {

    const [currentIdx,   setCurrentIdx]   = useState(0);
    const [isPlaying,    setIsPlaying]     = useState(false);
    const [activeChord,  setActiveChord]   = useState(-1);
    const [activeBeat,   setActiveBeat]    = useState(-1);

    const total = COMMON_PROGRESSIONS.length;
    const prog  = COMMON_PROGRESSIONS[currentIdx];

    /* ── scheduler refs ───────────────────────────────────────────────── */
    const schedulerRef   = useRef<number | null>(null);
    const isPlayingRef   = useRef(false);
    const chordsRef      = useRef<ReturnType<typeof getProgressionChords>>([]);
    const nextTimeRef    = useRef(0);
    const nextChordRef   = useRef(0);
    const nextBeatRef    = useRef(0);
    const uiTimersRef    = useRef<number[]>([]);

    const tickRef = useRef<() => void>(() => {});
    useEffect(() => {
        tickRef.current = () => {
            if (!isPlayingRef.current) return;
            const ctx    = guitarService.audioContext;
            const chords = chordsRef.current;

            while (nextTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const ci = nextChordRef.current;
                const bi = nextBeatRef.current;
                const t  = nextTimeRef.current;

                chords[ci].voicing.forEach((fret, si) => {
                    if (fret !== null) {
                        guitarService.playNoteAt(
                            tuning[si] + fret, soundMode,
                            t + si * STRUM_SPREAD, NOTE_DUR
                        );
                    }
                });

                const delayMs = Math.max((t - ctx.currentTime) * 1000, 0);
                const timer = window.setTimeout(() => {
                    setActiveChord(ci);
                    setActiveBeat(bi);
                }, delayMs);
                uiTimersRef.current.push(timer);

                nextTimeRef.current += BEAT_DUR;
                const nextBi = (bi + 1) % 4;
                nextBeatRef.current = nextBi;
                if (nextBi === 0) nextChordRef.current = (ci + 1) % chords.length;
            }
        };
    }, [guitarService, tuning, soundMode]);

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

    const play = useCallback((progIdx: number) => {
        teardown();

        const chords = getProgressionChords(keySig, COMMON_PROGRESSIONS[progIdx], tuning);
        if (!chords.length) return;

        guitarService.audioContext.resume().then(() => {
            const ctx = guitarService.audioContext;

            chordsRef.current    = chords;
            nextTimeRef.current  = ctx.currentTime + 0.05;
            nextChordRef.current = 0;
            nextBeatRef.current  = 0;
            isPlayingRef.current = true;

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

    return (
        <div className="progression-section">
            <div className="progression-header">
                <div className="prog-nav-row">
                    <button className="prog-nav-btn" onClick={() => navigate(-1)} aria-label="Previous">&#8249;</button>

                    <div className="prog-info">
                        <span className="prog-name">{prog.name}</span>
                        <span className="prog-genre">{prog.genre}</span>
                    </div>

                    <button className="prog-nav-btn" onClick={() => navigate(1)} aria-label="Next">&#8250;</button>

                    <div className="prog-beats">
                        {[0, 1, 2, 3].map(b => (
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
