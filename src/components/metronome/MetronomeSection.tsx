import React, { useState, useRef, useCallback, useEffect } from 'react';
import './MetronomeSection.css';
import { GuitarService } from '../../services/guitar.service';
import { TimeSig, LOOKAHEAD_S, TICK_MS } from '../../models/playback';

interface IMetronome {
    guitarService: GuitarService;
    bpm:     number;
    timeSig: TimeSig;
}

export function MetronomeSection({ guitarService, bpm, timeSig }: IMetronome) {
    const [isPlaying,  setIsPlaying]  = useState(false);
    const [activeBeat, setActiveBeat] = useState(-1);

    const schedulerRef    = useRef<number | null>(null);
    const isPlayingRef    = useRef(false);
    const nextBeatTimeRef = useRef(0);
    const nextBeatIdxRef  = useRef(0);
    const uiTimersRef     = useRef<number[]>([]);
    const bpmRef          = useRef(bpm);
    const timeSigRef      = useRef<TimeSig>(timeSig);

    useEffect(() => { bpmRef.current     = bpm;    }, [bpm]);
    useEffect(() => { timeSigRef.current = timeSig; }, [timeSig]);

    const tickRef = useRef<() => void>(() => {});
    useEffect(() => {
        tickRef.current = () => {
            if (!isPlayingRef.current) return;
            const ctx     = guitarService.audioContext;
            const ts      = timeSigRef.current;
            const beatSec = ts.beatDurQN * (60 / bpmRef.current);

            while (nextBeatTimeRef.current < ctx.currentTime + LOOKAHEAD_S) {
                const bi      = nextBeatIdxRef.current;
                const t       = nextBeatTimeRef.current;
                guitarService.playClick(t, bi === 0);
                const delayMs = Math.max((t - ctx.currentTime) * 1000, 0);
                const timer   = window.setTimeout(() => setActiveBeat(bi), delayMs);
                uiTimersRef.current.push(timer);
                nextBeatTimeRef.current += beatSec;
                nextBeatIdxRef.current   = (bi + 1) % ts.beats;
            }
        };
    }, [guitarService]);

    const teardown = useCallback(() => {
        isPlayingRef.current = false;
        if (schedulerRef.current !== null) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
        uiTimersRef.current.forEach(clearTimeout);
        uiTimersRef.current = [];
    }, []);

    const stop = useCallback(() => {
        teardown();
        setIsPlaying(false);
        setActiveBeat(-1);
    }, [teardown]);

    const play = useCallback(() => {
        teardown();
        guitarService.audioContext.resume().then(() => {
            const ctx = guitarService.audioContext;
            const t0  = ctx.currentTime + 0.05;
            nextBeatTimeRef.current = t0;
            nextBeatIdxRef.current  = 0;
            isPlayingRef.current    = true;
            tickRef.current();
            schedulerRef.current = window.setInterval(() => tickRef.current(), TICK_MS);
            setIsPlaying(true);
            setActiveBeat(0);
        });
    }, [guitarService, teardown]);

    useEffect(() => () => teardown(), [teardown]);

    return (
        <div className="metronome-section">
            <div className="metro-header">
                <span className="metro-title">Metronome</span>
                <button
                    className={`metro-play-btn${isPlaying ? ' metro-play-btn--playing' : ''}`}
                    onClick={() => isPlaying ? stop() : play()}
                    aria-label={isPlaying ? 'Stop' : 'Play'}
                >
                    {isPlaying ? '■' : '▶'}
                </button>
            </div>

            <div className="metro-info-row">
                <span className="metro-info-bpm">{bpm}</span>
                <span className="metro-info-unit">BPM</span>
                <span className="metro-info-sep">·</span>
                <span className="metro-info-ts">{timeSig.label}</span>
            </div>

            <div className="metro-beats-row">
                {Array.from({ length: timeSig.beats }, (_, b) => (
                    <span
                        key={b}
                        className={`metro-beat${b === 0 ? ' metro-beat--accent' : ''}${isPlaying && activeBeat === b ? ' metro-beat--on' : ''}`}
                    />
                ))}
            </div>
        </div>
    );
}
