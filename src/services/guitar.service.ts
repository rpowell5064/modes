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

    private createKarplusStrong(note: number, brightness: number, decay: number): AudioBufferSourceNode {
        const ctx = this.audioContext;
        const freq = this.noteFrequency(note);
        const sampleRate = ctx.sampleRate;
        const period = Math.round(sampleRate / freq);

        // Pre-render 4 s of K-S synthesis into a buffer so playback is
        // glitch-free (ScriptProcessorNode runs on the main thread and drops
        // samples whenever JS is busy).
        const numSamples = Math.floor(sampleRate * 4);
        const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
        const data = audioBuffer.getChannelData(0);

        // Pluck excitation: white noise burst fills the delay line
        const delayLine = new Float32Array(period);
        for (let i = 0; i < period; i++) {
            delayLine[i] = (Math.random() * 2 - 1) * 0.85;
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
        body.gain.value = 3;

        // String attack and clarity
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 2800;
        presence.Q.value = 0.9;
        presence.gain.value = 5;

        // Natural high-frequency rolloff (pickup + amp)
        const rolloff = ctx.createBiquadFilter();
        rolloff.type = 'highshelf';
        rolloff.frequency.value = 7000;
        rolloff.gain.value = -12;

        // Light compression for even, natural dynamics
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 3;
        comp.attack.value = 0.005;
        comp.release.value = 0.15;

        const output = ctx.createGain();
        output.gain.value = 0.7;

        source.connect(body);
        body.connect(presence);
        presence.connect(rolloff);
        rolloff.connect(comp);
        comp.connect(output);

        return output;
    }

    /** Play a note at a precise Web Audio clock time with a fixed sustain duration.
     *  Used by the progression looper so notes cut off cleanly before the next strum. */
    playNoteAt(note: number, mode: SoundMode, startTime: number, noteDuration: number): void {
        const ctx = this.audioContext;
        const source = this.createKarplusStrong(note, 0.45, 0.9994);
        const chain  = this.buildCleanChain(source);

        const masterGain  = ctx.createGain();
        const releaseTime = 0.10;

        masterGain.gain.setValueAtTime(1, startTime);
        masterGain.gain.setValueAtTime(1, startTime + noteDuration);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseTime);

        chain.connect(masterGain);
        masterGain.connect(ctx.destination);
        source.start(startTime);

        const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseTime + 0.3) * 1000;
        setTimeout(() => {
            try { source.stop();        } catch (_) {}
            try { source.disconnect();  } catch (_) {}
            try { masterGain.disconnect(); } catch (_) {}
        }, Math.max(cleanupMs, 50));
    }

    playNote(note: number, mode: SoundMode): void {
        const ctx = this.audioContext;
        const source = this.createKarplusStrong(note, 0.45, 0.9994);
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
