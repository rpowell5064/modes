import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import './ProgressionSection.css';
import { ChordDiagram } from './ChordDiagram';
import { ChordDefinition, COMMON_PROGRESSIONS, getProgressionChords, chordNameToDefinition } from '../../models/chords';
import { GuitarService, SoundMode } from '../../services/guitar.service';
import {
    NoteLength, NOTE_LENGTH_BEATS, TimeSig,
    LOOKAHEAD_S, TICK_MS,
} from '../../models/playback';

interface SongOverride {
    title:  string;
    artist: string;
    chords: string[];
}

interface IProgressionSection {
    keySig:        number;
    tuning:        number[];
    guitarService: GuitarService;
    soundMode:     SoundMode;
    bpm:           number;
    timeSig:       TimeSig;
    noteLength:    NoteLength;
    songOverride?: SongOverride;
    onClearSong?:  () => void;
}

const STRUM_SPREAD = 0.026;  // seconds between successive strings in a strum

export function ProgressionSection({ keySig, tuning, guitarService, soundMode, bpm, timeSig, noteLength, songOverride, onClearSong }: IProgressionSection) {

    const [currentIdx,  setCurrentIdx]  = useState(0);
    const [isPlaying,   setIsPlaying]   = useState(false);
    const [activeChord, setActiveChord] = useState(-1);
    const [activeBeat,  setActiveBeat]  = useState(-1);

    const total = COMMON_PROGRESSIONS.length;
    const prog  = COMMON_PROGRESSIONS[currentIdx];

    const schedulerRef     = useRef<number | null>(null);
    const isPlayingRef     = useRef(false);
    const chordsRef        = useRef<ChordDefinition[]>([]);
    const nextChordTimeRef = useRef(0);
    const nextBeatTimeRef  = useRef(0);
    const nextChordRef     = useRef(0);
    const nextBeatDotRef   = useRef(0);
    const uiTimersRef      = useRef<number[]>([]);

    const bpmRef        = useRef(bpm);
    const noteLenRef    = useRef<NoteLength>(noteLength);
    const timeSigRef    = useRef<TimeSig>(timeSig);

    useEffect(() => { bpmRef.current     = bpm;       }, [bpm]);
    useEffect(() => { noteLenRef.current = noteLength; }, [noteLength]);
    useEffect(() => { timeSigRef.current = timeSig;   }, [timeSig]);

    const tickRef = useRef<() => void>(() => {});
    useEffect(() => {
        tickRef.current = () => {
            if (!isPlayingRef.current) return;

            const ctx    = guitarService.audioContext;
            const chords = chordsRef.current;
            const ts     = timeSigRef.current;

            const qnSec      = 60 / bpmRef.current;
            const beatSec    = ts.beatDurQN * qnSec;
            const measureSec = ts.beats * beatSec;

            const strumQN  = noteLenRef.current === 'whole'
                ? ts.beats * ts.beatDurQN
                : NOTE_LENGTH_BEATS[noteLenRef.current];
            const strumSec   = strumQN * qnSec;
            const numStrums  = Math.max(1, Math.round(measureSec / strumSec));
            const releaseSec = Math.min(strumSec * 0.5, 2.0);

            while (nextBeatTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const bi      = nextBeatDotRef.current;
                const t       = nextBeatTimeRef.current;
                const delayMs = Math.max((t - ctx.currentTime) * 1000, 0);
                const timer   = window.setTimeout(() => setActiveBeat(bi), delayMs);
                uiTimersRef.current.push(timer);
                nextBeatTimeRef.current   += beatSec;
                nextBeatDotRef.current     = (bi + 1) % ts.beats;
            }

            while (nextChordTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const ci           = nextChordRef.current;
                const measureStart = nextChordTimeRef.current;

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

    // Stop playback whenever the song override changes
    useEffect(() => {
        stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songOverride]);

    // Parse song chords into ChordDefinitions (re-computed when tuning changes)
    const songChords = useMemo<ChordDefinition[] | null>(() => {
        if (!songOverride) return null;
        return songOverride.chords
            .map(name => chordNameToDefinition(name, tuning))
            .filter((c): c is ChordDefinition => c !== null);
    }, [songOverride, tuning]);

    const startPlayback = useCallback((chords: ChordDefinition[]) => {
        teardown();
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
    }, [guitarService, teardown]);

    const play = useCallback((progIdx: number) => {
        startPlayback(getProgressionChords(keySig, COMMON_PROGRESSIONS[progIdx], tuning));
    }, [keySig, tuning, startPlayback]);

    const navigate = useCallback((delta: number) => {
        if (isPlaying) stop();
        setCurrentIdx(i => (i + delta + total) % total);
    }, [isPlaying, stop, total]);

    const handlePlayToggle = () => {
        if (isPlaying) {
            stop();
        } else if (songChords && songChords.length > 0) {
            startPlayback(songChords);
        } else {
            play(currentIdx);
        }
    };

    const displayChords = songChords ?? getProgressionChords(keySig, prog, tuning);

    return (
        <div className="progression-section">
            <div className="progression-header">

                <div className="prog-nav-row">
                    {songOverride ? (
                        <div className="prog-song-info">
                            <span className="prog-song-title">{songOverride.title}</span>
                            <span className="prog-song-sep"> — </span>
                            <span className="prog-song-artist">{songOverride.artist}</span>
                            <button
                                className="prog-song-clear"
                                onClick={() => { stop(); onClearSong?.(); }}
                                aria-label="Clear song"
                            >✕</button>
                        </div>
                    ) : (
                        <>
                            <button className="prog-nav-btn" onClick={() => navigate(-1)} aria-label="Previous">&#8249;</button>
                            <div className="prog-info">
                                <span className="prog-name">{prog.name}</span>
                                <span className="prog-genre">{prog.genre}</span>
                            </div>
                            <button className="prog-nav-btn" onClick={() => navigate(1)} aria-label="Next">&#8250;</button>
                        </>
                    )}

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
                        onClick={handlePlayToggle}
                        aria-label={isPlaying ? 'Stop' : 'Play'}
                    >
                        {isPlaying ? '■' : '▶'}
                    </button>
                </div>

                {!songOverride && (
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
                )}
            </div>

            <div className={`prog-card-chords${songOverride ? ' prog-card-chords--song' : ''}`}>
                {displayChords.map((chord, ci) => (
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
