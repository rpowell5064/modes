import React, { useState, useRef, useCallback, useEffect } from 'react';
import './TunerSection.css';
import { GuitarService } from '../../services/guitar.service';

interface ITuner { guitarService: GuitarService }

const NOTE_NAMES  = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const STANDARD_6  = [{ label: 'E2', midi: 40 }, { label: 'A2', midi: 45 },
                     { label: 'D3', midi: 50 }, { label: 'G3', midi: 55 },
                     { label: 'B3', midi: 59 }, { label: 'E4', midi: 64 }];

function midiToFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

function detectPitch(buf: Float32Array, sampleRate: number): number {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    if (Math.sqrt(rms / SIZE) < 0.008) return -1;

    // Autocorrelation over first half of buffer (enough for guitar range)
    const HALF = SIZE >> 1;
    const corr = new Float32Array(HALF);
    for (let lag = 0; lag < HALF; lag++) {
        let s = 0;
        for (let i = 0; i < HALF; i++) s += buf[i] * buf[i + lag];
        corr[lag] = s;
    }

    // Skip initial decay to first local minimum
    let d = 1;
    while (d < HALF - 1 && corr[d] > corr[d - 1]) d++;
    while (d < HALF - 1 && corr[d] < corr[d - 1]) d++;

    // Find max peak
    let maxVal = -Infinity, maxPos = -1;
    for (let i = d; i < HALF; i++) {
        if (corr[i] > maxVal) { maxVal = corr[i]; maxPos = i; }
    }
    if (maxPos <= 0) return -1;

    // Parabolic interpolation for sub-sample precision
    const a = corr[maxPos - 1] ?? corr[maxPos];
    const c = corr[maxPos + 1] ?? corr[maxPos];
    const shift = (c - a) / (2 * (2 * corr[maxPos] - a - c));
    return sampleRate / (maxPos + shift);
}

export function TunerSection({ guitarService }: ITuner) {
    const [isActive,    setIsActive]    = useState(false);
    const [noteName,    setNoteName]    = useState<string | null>(null);
    const [cents,       setCents]       = useState(0);
    const [frequency,   setFrequency]   = useState<number | null>(null);
    const [refMidi,     setRefMidi]     = useState<number | null>(null);

    const analyserRef  = useRef<AnalyserNode | null>(null);
    const streamRef    = useRef<MediaStream | null>(null);
    const rafRef       = useRef<number | null>(null);
    const sourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);

    const stopTuner = useCallback(() => {
        if (rafRef.current)    { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch (_) {} sourceRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        analyserRef.current = null;
        setIsActive(false);
        setNoteName(null);
        setFrequency(null);
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
            analyserRef.current = source.connect(analyser) as unknown as AnalyserNode;
            // keep the actual analyser ref:
            analyserRef.current = analyser;
            sourceRef.current = source;

            const buf = new Float32Array(analyser.fftSize);

            const loop = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getFloatTimeDomainData(buf);
                const freq = detectPitch(buf, ctx.sampleRate);
                if (freq > 0) {
                    const midi    = Math.round(12 * Math.log2(freq / 440) + 69);
                    const target  = midiToFreq(midi);
                    const c       = Math.round(1200 * Math.log2(freq / target));
                    const name    = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
                    setNoteName(name);
                    setCents(c);
                    setFrequency(freq);
                } else {
                    setNoteName(null);
                    setFrequency(null);
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

    const absCents     = Math.abs(cents);
    const tuneClass    = absCents <= 5 ? 'intune' : absCents <= 15 ? 'close' : 'off';
    // Needle position: 0% = flat 50, 50% = center, 100% = sharp 50
    const needlePct    = 50 + Math.max(-50, Math.min(50, cents));

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

            {isActive ? (
                noteName ? (
                    <>
                        <div className="tuner-note-row">
                            <span className={`tuner-note-name tuner-note-name--${tuneClass}`}>
                                {noteName}
                            </span>
                            <span className="tuner-freq">{frequency!.toFixed(1)} Hz</span>
                            <span className="tuner-cents-value">
                                {cents > 0 ? '+' : ''}{cents}¢
                            </span>
                        </div>

                        <div className="tuner-gauge-wrap">
                            <div className="tuner-gauge-track">
                                <div className="tuner-gauge-zone" />
                                <div
                                    className={`tuner-gauge-needle tuner-gauge-needle--${tuneClass}`}
                                    style={{ left: `${needlePct}%` }}
                                />
                            </div>
                        </div>
                        <div className="tuner-gauge-labels">
                            <span>♭ 50</span><span>25</span><span>0</span><span>25</span><span>♯ 50</span>
                        </div>
                    </>
                ) : (
                    <p className="tuner-silent">Listening… play a note</p>
                )
            ) : (
                <p className="tuner-silent">Press Start and play a note</p>
            )}

            {/* Quick reference: standard tuning string buttons */}
            <div className="tuner-ref-row">
                <span className="tuner-ref-label">Ref</span>
                {STANDARD_6.map(s => (
                    <button key={s.midi}
                            className={`tuner-ref-btn${refMidi === s.midi ? ' tuner-ref-btn--active' : ''}`}
                            onClick={() => {
                                setRefMidi(r => r === s.midi ? null : s.midi);
                                guitarService.audioContext.resume().then(() =>
                                    guitarService.playNote(s.midi, 'clean'));
                            }}>
                        {s.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
