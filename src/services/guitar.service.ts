export type SoundMode = 'clean' | 'distorted';

export class GuitarService {
    audioContext: AudioContext;

    constructor() {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
    }

    private noteFrequency(note: number): number {
        // Standard MIDI: A4 (note 69) = 440 Hz
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    private createKarplusStrong(note: number, brightness: number, decay: number, durationSec = 4): AudioBufferSourceNode {
        const ctx = this.audioContext;
        const freq = this.noteFrequency(note);
        const sampleRate = ctx.sampleRate;
        const period = Math.round(sampleRate / freq);

        // Pre-render into a buffer so playback is glitch-free.
        // durationSec is extended for long chord hold-times.
        const numSamples = Math.floor(sampleRate * durationSec);
        const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
        const data = audioBuffer.getChannelData(0);

        // Pluck excitation: white noise burst fills the delay line
        const delayLine = new Float32Array(period);
        for (let i = 0; i < period; i++) {
            delayLine[i] = (Math.random() * 2 - 1) * 0.65;
        }

        let pos = 0;
        for (let i = 0; i < numSamples; i++) {
            const next = (pos + 1) % period;
            data[i] = delayLine[pos];
            // Karplus-Strong feedback: brightness controls low-pass blend
            delayLine[pos] = decay * ((1 - brightness) * delayLine[pos] + brightness * delayLine[next]);
            pos = next;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        return source;
    }

    private buildCleanChain(source: AudioNode): AudioNode {
        const ctx = this.audioContext;

        // Body warmth — low-mid resonance of the guitar body
        const body = ctx.createBiquadFilter();
        body.type = 'peaking';
        body.frequency.value = 250;
        body.Q.value = 0.8;
        body.gain.value = 2;

        // Subtle string presence/clarity
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 2800;
        presence.Q.value = 0.9;
        presence.gain.value = 1.5;

        // Natural high-frequency rolloff (pickup + amp)
        const rolloff = ctx.createBiquadFilter();
        rolloff.type = 'highshelf';
        rolloff.frequency.value = 7000;
        rolloff.gain.value = -10;

        // Light compression for even, natural dynamics
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 14;
        comp.ratio.value = 3;
        comp.attack.value = 0.005;
        comp.release.value = 0.20;

        // Hard limiter to prevent clipping on mobile / high volumes
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 2;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;

        const output = ctx.createGain();
        output.gain.value = 0.40;

        source.connect(body);
        body.connect(presence);
        presence.connect(rolloff);
        rolloff.connect(comp);
        comp.connect(limiter);
        limiter.connect(output);

        return output;
    }

    /** Play a note at a precise Web Audio clock time with a fixed sustain duration.
     *  releaseDur controls how long the gain fades after noteDuration — callers
     *  should scale this to the chord length so shorter notes ring naturally. */
    playNoteAt(note: number, mode: SoundMode, startTime: number, noteDuration: number, releaseDur = 0.10): void {
        const ctx = this.audioContext;
        // Pre-render enough buffer to cover sustain + release + small headroom
        const bufDur = Math.ceil(noteDuration + releaseDur + 0.5);
        const source = this.createKarplusStrong(note, 0.45, 0.9994, bufDur);
        const chain  = this.buildCleanChain(source);

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(1, startTime);
        masterGain.gain.setValueAtTime(1, startTime + noteDuration);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseDur);

        chain.connect(masterGain);
        masterGain.connect(ctx.destination);
        source.start(startTime);

        const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseDur + 0.3) * 1000;
        setTimeout(() => {
            try { source.stop();           } catch (_) {}
            try { source.disconnect();     } catch (_) {}
            try { masterGain.disconnect(); } catch (_) {}
        }, Math.max(cleanupMs, 50));
    }

    /** Short click for metronome use. isAccent = beat 1 (higher pitch, louder). */
    playClick(audioTime: number, isAccent: boolean): void {
        const ctx  = this.audioContext;
        const freq = isAccent ? 1000 : 750;
        const dur  = 0.030;

        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioTime);
        gain.gain.setValueAtTime(0, audioTime);
        gain.gain.linearRampToValueAtTime(isAccent ? 0.65 : 0.40, audioTime + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.001, audioTime + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(audioTime);
        osc.stop(audioTime + dur + 0.005);
    }

    playNote(note: number, mode: SoundMode): void {
        const ctx = this.audioContext;
        const source = this.createKarplusStrong(note, 0.45, 0.9994, 6);
        const chain = this.buildCleanChain(source);

        const masterGain = ctx.createGain();
        const sustainTime = 2.0;
        const releaseTime = 1.5;

        masterGain.gain.setValueAtTime(1, ctx.currentTime);
        masterGain.gain.setValueAtTime(1, ctx.currentTime + sustainTime);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sustainTime + releaseTime);

        chain.connect(masterGain);
        masterGain.connect(ctx.destination);
        source.start();

        const cleanupMs = (sustainTime + releaseTime + 0.3) * 1000;
        setTimeout(() => {
            try { source.stop(); } catch (_) {}
            try { source.disconnect(); } catch (_) {}
            try { masterGain.disconnect(); } catch (_) {}
        }, cleanupMs);
    }
}
