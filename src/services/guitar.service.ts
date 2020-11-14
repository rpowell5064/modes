export class GuitarService {
    AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext: AudioContext;

    constructor() {
        this.audioContext = new this.AudioContext();
    }

    getFilterNodeByNoteNumber(note: number): BiquadFilterNode {

        const guitarNote = this.audioContext.createScriptProcessor(4096, 0, 1);

        const noteSignal = Math.round(this.audioContext.sampleRate / ((440 / 64) * (2 ** ((note - 9) / 12))));

        const currentSignal = new Float32Array(noteSignal);

        for (let i = 0; i < noteSignal; i++) {
            currentSignal[i] = Math.random() * 2 - 1;
        }
    
        let signalCount = 0;

        guitarNote.onaudioprocess = function (e: AudioProcessingEvent) {
            const output = e.outputBuffer.getChannelData(0);
    
            for (let i = 0; i < e.outputBuffer.length; i++) {
                currentSignal[signalCount] = (currentSignal[signalCount] + currentSignal[(signalCount + 1) % noteSignal]) / 2;

                output[i] = currentSignal[signalCount];
    
                currentSignal[signalCount] *= 0.99;
    
                signalCount++;
                
                if (signalCount >= noteSignal) { 
                    signalCount = 0;
                }
            }
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = note;
        filter.Q.value = 1/6;
    
        guitarNote.connect(filter);

        setTimeout(function() { 
            guitarNote.disconnect();
            filter.disconnect();
        }, 2000);

        return filter
    }
}
