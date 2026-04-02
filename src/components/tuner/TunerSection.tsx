import React, { useState, useRef, useCallback, useEffect } from 'react';
import './TunerSection.css';
import { GuitarService } from '../../services/guitar.service';

interface ITuner { guitarService: GuitarService; tuning: number[] }

const NOTE_NAMES  = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiLabel(midi: number): string {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// How long (ms) to hold the last detected note before clearing the display.
// This prevents the display from flickering between notes.
const HOLD_MS = 700;

interface Detection { noteName: string; cents: number; frequency: number }

function midiToFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

function detectPitch(buf: Float32Array, sampleRate: number): number {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    if (Math.sqrt(rms / SIZE) < 0.008) return -1;

    const HALF = SIZE >> 1;
    const corr = new Float32Array(HALF);
    for (let lag = 0; lag < HALF; lag++) {
        let s = 0;
        for (let i = 0; i < HALF; i++) s += buf[i] * buf[i + lag];
        corr[lag] = s;
    }

    let d = 1;
    while (d < HALF - 1 && corr[d] > corr[d - 1]) d++;
    while (d < HALF - 1 && corr[d] < corr[d - 1]) d++;

    let maxVal = -Infinity, maxPos = -1;
    for (let i = d; i < HALF; i++) {
        if (corr[i] > maxVal) { maxVal = corr[i]; maxPos = i; }
    }
    if (maxPos <= 0) return -1;

    const a = corr[maxPos - 1] ?? corr[maxPos];
    const c = corr[maxPos + 1] ?? corr[maxPos];
    const denom = 2 * corr[maxPos] - a - c;
    const shift = denom !== 0 ? (c - a) / (2 * denom) : 0;
    return sampleRate / (maxPos + shift);
}

export function TunerSection({ guitarService, tuning }: ITuner) {
    const [isActive,   setIsActive]   = useState(false);
    const [detection,  setDetection]  = useState<Detection | null>(null);
    const [refMidi,    setRefMidi]    = useState<number | null>(null);

    const analyserRef   = useRef<AnalyserNode | null>(null);
    const streamRef     = useRef<MediaStream | null>(null);
    const rafRef        = useRef<number | null>(null);
    const sourceRef     = useRef<MediaStreamAudioSourceNode | null>(null);
    const holdTimerRef  = useRef<number | null>(null);

    const clearHoldTimer = () => {
        if (holdTimerRef.current !== null) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    };

    const stopTuner = useCallback(() => {
        clearHoldTimer();
        if (rafRef.current)    { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch (_) {} sourceRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        analyserRef.current = null;
        setIsActive(false);
        setDetection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startTuner = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;
            const ctx = guitarService.audioContext;
            await ctx.resume();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 4096;
            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            analyserRef.current = analyser;
            sourceRef.current = source;

            const buf = new Float32Array(analyser.fftSize);

            const loop = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getFloatTimeDomainData(buf);
                const freq = detectPitch(buf, ctx.sampleRate);

                if (freq > 0) {
                    // Clear any pending hold-decay timer — we have a fresh reading
                    clearHoldTimer();
                    const midi    = Math.round(12 * Math.log2(freq / 440) + 69);
                    const target  = midiToFreq(midi);
                    const cents   = Math.round(1200 * Math.log2(freq / target));
                    const name    = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
                    // Single setState call → one render → no React 16 race
                    setDetection({ noteName: name, cents, frequency: freq });
                } else if (holdTimerRef.current === null) {
                    // Silence detected — wait HOLD_MS before clearing display
                    holdTimerRef.current = window.setTimeout(() => {
                        holdTimerRef.current = null;
                        setDetection(null);
                    }, HOLD_MS);
                }

                rafRef.current = requestAnimationFrame(loop);
            };
            rafRef.current = requestAnimationFrame(loop);
            setIsActive(true);
        } catch (err) {
            console.warn('Tuner: mic access denied', err);
        }
    }, [guitarService]);

    useEffect(() => () => stopTuner(), [stopTuner]);

    // Clear the active ref button if the tuning changes and it no longer matches any string
    useEffect(() => {
        setRefMidi(r => (r !== null && tuning.includes(r) ? r : null));
    }, [tuning]);

    const cents     = detection?.cents ?? 0;
    const absCents  = Math.abs(cents);
    const tuneClass = absCents <= 5 ? 'intune' : absCents <= 15 ? 'close' : 'off';
    // Needle position: 0 % = flat 50, 50 % = center, 100 % = sharp 50
    const needlePct = 50 + Math.max(-50, Math.min(50, cents));
    // When no detection, needle sits at center with low opacity
    const hasNote   = detection !== null;

    return (
        <div className="tuner-section">
            <div className="tuner-header">
                <span className="tuner-title">Tuner</span>
                <button
                    className={`tuner-toggle-btn${isActive ? ' tuner-toggle-btn--active' : ''}`}
                    onClick={() => isActive ? stopTuner() : startTuner()}
                >
                    {isActive ? 'Stop' : 'Start'}
                </button>
            </div>

            {/* Fixed-height note display — always present so layout never shifts */}
            <div className="tuner-note-area">
                <span className={`tuner-note-name tuner-note-name--${tuneClass}${!hasNote ? ' tuner-note-name--empty' : ''}`}>
                    {hasNote ? detection!.noteName : '—'}
                </span>
                <div className="tuner-note-meta">
                    <span className="tuner-freq">
                        {hasNote ? `${detection!.frequency.toFixed(1)} Hz` : isActive ? 'listening…' : ''}
                    </span>
                    <span className={`tuner-cents tuner-cents--${tuneClass}${!hasNote ? ' tuner-cents--empty' : ''}`}>
                        {hasNote ? `${cents > 0 ? '+' : ''}${cents}¢` : ''}
                    </span>
                </div>
            </div>

            {/* Gauge — always visible; needle fades when no signal */}
            <div className="tuner-gauge-wrap">
                <div className="tuner-gauge-track">
                    <div className="tuner-gauge-zone" />
                    <div
                        className={`tuner-gauge-needle tuner-gauge-needle--${tuneClass}${!hasNote ? ' tuner-gauge-needle--idle' : ''}`}
                        style={{ left: `${needlePct}%` }}
                    />
                </div>
            </div>
            <div className="tuner-gauge-labels">
                <span>♭50</span><span>25</span><span>0</span><span>25</span><span>♯50</span>
            </div>

            <div className="tuner-ref-row">
                <span className="tuner-ref-label">Ref</span>
                {tuning.map(midi => (
                    <button key={midi}
                            className={`tuner-ref-btn${refMidi === midi ? ' tuner-ref-btn--active' : ''}`}
                            onClick={() => {
                                setRefMidi(r => r === midi ? null : midi);
                                guitarService.audioContext.resume().then(() =>
                                    guitarService.playNote(midi, 'clean'));
                            }}>
                        {midiLabel(midi)}
                    </button>
                ))}
            </div>
        </div>
    );
}
