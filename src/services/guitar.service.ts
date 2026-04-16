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

    private createKarplusStrong(note: number, brightness: number, decay: number, durationSec = 4, excitation = 0.65): AudioBufferSourceNode {
        const ctx = this.audioContext;
        const freq = this.noteFrequency(note);
        const sampleRate = ctx.sampleRate;
        const period = Math.round(sampleRate / freq);

        // Pre-render into a buffer so playback is glitch-free.
        // durationSec is extended for long chord hold-times.
        const numSamples = Math.floor(sampleRate * durationSec);
        const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
        const data = audioBuffer.getChannelData(0);

        // Pluck excitation: white noise burst fills the delay line.
        // `excitation` controls the attack energy (0.65 = full pick, ~0.28 = soft hammer).
        const delayLine = new Float32Array(period);
        for (let i = 0; i < period; i++) {
            delayLine[i] = (Math.random() * 2 - 1) * excitation;
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

    /** Short muted / dead-string thump for 'x' notes. */
    playMutedNote(audioTime: number): void {
        const ctx = this.audioContext;
        const dur = 0.055;
        const bufSize = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        // Low-pass + resonance to shape the muted thump
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 260;
        lpf.Q.value = 2.5;

        const body = ctx.createBiquadFilter();
        body.type = 'peaking';
        body.frequency.value = 120;
        body.Q.value = 1.0;
        body.gain.value = 6;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, audioTime);
        gain.gain.linearRampToValueAtTime(0.55, audioTime + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, audioTime + dur);

        src.connect(lpf);
        lpf.connect(body);
        body.connect(gain);
        gain.connect(ctx.destination);
        src.start(audioTime);
        src.stop(audioTime + dur + 0.01);
    }

    /** Pitch-bend: cross-fades from baseMidi up to baseMidi+bendSemitones.
     *  The source note fades quickly while the target pitch ramps in. */
    playBendNoteAt(
        baseMidi: number, bendSemitones: number, mode: SoundMode,
        startTime: number, noteDuration: number, releaseDur = 0.10,
    ): void {
        const ctx = this.audioContext;
        const targetMidi = baseMidi + bendSemitones;
        const bendDur = Math.max(0.06, Math.min(0.22, noteDuration * 0.35));

        // Source note — plucked, then quickly fades as the bend rises
        {
            const bufDur = Math.ceil(bendDur + 0.4);
            const src = this.createKarplusStrong(baseMidi, 0.45, 0.9994, bufDur);
            const chain = this.buildCleanChain(src);
            const mg = ctx.createGain();
            mg.gain.setValueAtTime(1, startTime);
            mg.gain.exponentialRampToValueAtTime(0.0001, startTime + bendDur);
            chain.connect(mg);
            mg.connect(ctx.destination);
            src.start(startTime);
            const cleanupMs = (startTime - ctx.currentTime + bendDur + 0.4) * 1000;
            setTimeout(() => {
                try { src.stop(); }           catch (_) {}
                try { src.disconnect(); }     catch (_) {}
                try { mg.disconnect(); }      catch (_) {}
            }, Math.max(cleanupMs, 50));
        }

        // Target note — ramps in over the same window, then sustains at full pitch
        {
            const bufDur = Math.ceil(noteDuration + releaseDur + 0.5);
            const src = this.createKarplusStrong(targetMidi, 0.45, 0.9994, bufDur);
            const chain = this.buildCleanChain(src);
            const mg = ctx.createGain();
            mg.gain.setValueAtTime(0, startTime);
            mg.gain.linearRampToValueAtTime(1, startTime + bendDur);
            mg.gain.setValueAtTime(1, startTime + noteDuration);
            mg.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseDur);
            chain.connect(mg);
            mg.connect(ctx.destination);
            src.start(startTime);
            const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseDur + 0.3) * 1000;
            setTimeout(() => {
                try { src.stop(); }           catch (_) {}
                try { src.disconnect(); }     catch (_) {}
                try { mg.disconnect(); }      catch (_) {}
            }, Math.max(cleanupMs, 50));
        }
    }

    /** Hammer-on: soft pluck (low excitation) with a brief finger-impact thud. */
    playHammerOnAt(note: number, mode: SoundMode, startTime: number, noteDuration: number, releaseDur = 0.10): void {
        const ctx = this.audioContext;
        const bufDur = Math.ceil(noteDuration + releaseDur + 0.5);
        // Low excitation = hammer strike energy, not pick attack
        const source = this.createKarplusStrong(note, 0.50, 0.9996, bufDur, 0.28);
        const chain  = this.buildCleanChain(source);

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.78, startTime);
        masterGain.gain.setValueAtTime(0.78, startTime + noteDuration);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseDur);

        chain.connect(masterGain);
        masterGain.connect(ctx.destination);
        source.start(startTime);

        // Finger-impact transient
        this.playFingerThud(startTime, 0.30);

        const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseDur + 0.3) * 1000;
        setTimeout(() => {
            try { source.stop();           } catch (_) {}
            try { source.disconnect();     } catch (_) {}
            try { masterGain.disconnect(); } catch (_) {}
        }, Math.max(cleanupMs, 50));
    }

    /** Pull-off: medium excitation with a subtle pop transient, slightly brighter. */
    playPullOffAt(note: number, mode: SoundMode, startTime: number, noteDuration: number, releaseDur = 0.10): void {
        const ctx = this.audioContext;
        const bufDur = Math.ceil(noteDuration + releaseDur + 0.5);
        // Pull-off is louder than hammer (finger pulls sideways, plucking the string)
        const source = this.createKarplusStrong(note, 0.47, 0.9994, bufDur, 0.38);
        const chain  = this.buildCleanChain(source);

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.85, startTime);
        masterGain.gain.setValueAtTime(0.85, startTime + noteDuration);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseDur);

        chain.connect(masterGain);
        masterGain.connect(ctx.destination);
        source.start(startTime);

        // Lighter finger-release transient
        this.playFingerThud(startTime, 0.18);

        const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseDur + 0.3) * 1000;
        setTimeout(() => {
            try { source.stop();           } catch (_) {}
            try { source.disconnect();     } catch (_) {}
            try { masterGain.disconnect(); } catch (_) {}
        }, Math.max(cleanupMs, 50));
    }

    /** Slide: cross-fades from fromMidi to toMidi with a sawtooth pitch-sweep in between. */
    playSlideAt(
        fromMidi: number, toMidi: number, mode: SoundMode,
        startTime: number, noteDuration: number, releaseDur = 0.10,
    ): void {
        const ctx = this.audioContext;
        const fromFreq = this.noteFrequency(fromMidi);
        const toFreq   = this.noteFrequency(toMidi);
        const slideDur = Math.max(0.06, Math.min(0.25, noteDuration * 0.40));

        // Source note — plucked at start, fades as the slide begins
        {
            const bufDur = Math.ceil(slideDur + 0.4);
            const src = this.createKarplusStrong(fromMidi, 0.45, 0.9994, bufDur);
            const chain = this.buildCleanChain(src);
            const mg = ctx.createGain();
            mg.gain.setValueAtTime(1, startTime);
            mg.gain.exponentialRampToValueAtTime(0.0001, startTime + slideDur);
            chain.connect(mg);
            mg.connect(ctx.destination);
            src.start(startTime);
            const cleanupMs = (startTime - ctx.currentTime + slideDur + 0.4) * 1000;
            setTimeout(() => {
                try { src.stop(); }       catch (_) {}
                try { src.disconnect(); } catch (_) {}
                try { mg.disconnect(); }  catch (_) {}
            }, Math.max(cleanupMs, 50));
        }

        // Pitch-sweep oscillator — sawtooth blends the two pitches during the slide window
        {
            const osc  = ctx.createOscillator();
            const lpf  = ctx.createBiquadFilter();
            const mg   = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(fromFreq, startTime);
            osc.frequency.exponentialRampToValueAtTime(toFreq, startTime + slideDur);

            lpf.type = 'lowpass';
            lpf.frequency.value = 900;

            mg.gain.setValueAtTime(0, startTime);
            mg.gain.linearRampToValueAtTime(0.18, startTime + 0.008);
            mg.gain.setValueAtTime(0.18, startTime + slideDur - 0.01);
            mg.gain.exponentialRampToValueAtTime(0.0001, startTime + slideDur + 0.04);

            osc.connect(lpf);
            lpf.connect(mg);
            mg.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + slideDur + 0.05);
        }

        // Target note — ramps in as slide lands, then sustains
        {
            const bufDur = Math.ceil(noteDuration + releaseDur + 0.5);
            const src = this.createKarplusStrong(toMidi, 0.45, 0.9994, bufDur);
            const chain = this.buildCleanChain(src);
            const mg = ctx.createGain();
            mg.gain.setValueAtTime(0, startTime);
            mg.gain.linearRampToValueAtTime(1, startTime + slideDur);
            mg.gain.setValueAtTime(1, startTime + noteDuration);
            mg.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration + releaseDur);
            chain.connect(mg);
            mg.connect(ctx.destination);
            src.start(startTime);
            const cleanupMs = (startTime - ctx.currentTime + noteDuration + releaseDur + 0.3) * 1000;
            setTimeout(() => {
                try { src.stop(); }       catch (_) {}
                try { src.disconnect(); } catch (_) {}
                try { mg.disconnect(); }  catch (_) {}
            }, Math.max(cleanupMs, 50));
        }
    }

    /** Short noise burst shaped to feel like a finger touching/leaving the string. */
    private playFingerThud(audioTime: number, gainPeak: number): void {
        const ctx = this.audioContext;
        const dur = 0.040;
        const bufSize = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 400;
        lpf.Q.value = 1.5;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, audioTime);
        gain.gain.linearRampToValueAtTime(gainPeak, audioTime + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, audioTime + dur);

        src.connect(lpf);
        lpf.connect(gain);
        gain.connect(ctx.destination);
        src.start(audioTime);
        src.stop(audioTime + dur + 0.005);
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
