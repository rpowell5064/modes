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

    // tanh soft-clipping / saturation curve — models tube overdrive
    private makeDistortionCurve(drive: number): Float32Array {
        const n = 512;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = Math.tanh(x * drive);
        }
        return curve;
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

    private buildDistortedChain(source: AudioNode): AudioNode {
        const ctx = this.audioContext;

        // Tight high-pass before gain stage — signature EVH 5150 punchy low end
        const inputHP = ctx.createBiquadFilter();
        inputHP.type = 'highpass';
        inputHP.frequency.value = 120;
        inputHP.Q.value = 0.65;

        // Tube saturation — drive reduced from 30 to keep harmonic richness
        // without turning the plucked string into a continuously bowed tone
        const saturator = ctx.createWaveShaper();
        saturator.curve = this.makeDistortionCurve(18);
        saturator.oversample = '4x'; // prevents aliasing from clipping

        // Post-clip HP — removes DC offset and sub-bass artifacts
        const postHP = ctx.createBiquadFilter();
        postHP.type = 'highpass';
        postHP.frequency.value = 85;
        postHP.Q.value = 0.7;

        // Mid scoop — 5150's characteristic V-shaped EQ
        const midScoop = ctx.createBiquadFilter();
        midScoop.type = 'peaking';
        midScoop.frequency.value = 480;
        midScoop.Q.value = 1.0;
        midScoop.gain.value = -10;

        // Celestion V30 cabinet low-mid thump
        const cabLow = ctx.createBiquadFilter();
        cabLow.type = 'peaking';
        cabLow.frequency.value = 130;
        cabLow.Q.value = 2.5;
        cabLow.gain.value = 6;

        // Presence edge — 5150 presence knob characteristic
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 3200;
        presence.Q.value = 1.2;
        presence.gain.value = 7;

        // 4x12 cabinet high rolloff (V30 natural response)
        const cabCut = ctx.createBiquadFilter();
        cabCut.type = 'lowpass';
        cabCut.frequency.value = 5800;
        cabCut.Q.value = 0.5;

        // Tight compression — high-gain amp natural behavior
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 3;
        comp.ratio.value = 12;
        comp.attack.value = 0.0005;
        comp.release.value = 0.04;

        const output = ctx.createGain();
        output.gain.value = 0.55;

        source.connect(inputHP);
        inputHP.connect(saturator);
        saturator.connect(postHP);
        postHP.connect(midScoop);
        midScoop.connect(cabLow);
        cabLow.connect(presence);
        presence.connect(cabCut);
        cabCut.connect(comp);
        comp.connect(output);

        return output;
    }

    playNote(note: number, mode: SoundMode): void {
        const ctx = this.audioContext;
        const isDistorted = mode === 'distorted';

        // Distorted: brighter excitation so attack cuts through saturation.
        // Decay must be lower for distorted — decay=0.999 sustains so long that
        // heavy clipping produces a continuous clipped sine (violin-like).
        // A shorter natural decay lets the note pluck and fade like a real guitar.
        const brightness = isDistorted ? 0.3 : 0.45;
        const decay = isDistorted ? 0.996 : 0.9994;

        const source = this.createKarplusStrong(note, brightness, decay);
        const chain = isDistorted
            ? this.buildDistortedChain(source)
            : this.buildCleanChain(source);

        // Smooth note envelope: sustain → exponential release
        const masterGain = ctx.createGain();
        const sustainTime = isDistorted ? 1.2 : 2.0;
        const releaseTime = isDistorted ? 0.5 : 1.5;

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
