export type ChordQuality = 'maj' | 'min' | 'dim' | 'aug';

export interface ChordDefinition {
    rootMidi: number;
    quality: ChordQuality;
    name: string;
    numeral: string;
    voicing: (number | null)[];  // fret per string (index 0 = lowest), null = muted
}

const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
};

// [semitone offset from key root, quality, roman numeral label]
type DegreeInfo = [number, ChordQuality, string];

const SCALE_DEGREES: DegreeInfo[][] = [
    // 0: Ionian (Major)
    [[0,'maj','I'],[2,'min','ii'],[4,'min','iii'],[5,'maj','IV'],[7,'maj','V'],[9,'min','vi'],[11,'dim','vii°']],
    // 1: Dorian
    [[0,'min','i'],[2,'min','ii'],[3,'maj','III'],[5,'maj','IV'],[7,'min','v'],[9,'dim','vi°'],[10,'maj','VII']],
    // 2: Phrygian
    [[0,'min','i'],[1,'maj','II'],[3,'maj','III'],[5,'min','iv'],[7,'dim','v°'],[8,'maj','VI'],[10,'min','vii']],
    // 3: Lydian
    [[0,'maj','I'],[2,'maj','II'],[4,'min','iii'],[6,'dim','#iv°'],[7,'maj','V'],[9,'min','vi'],[11,'min','vii']],
    // 4: Mixolydian
    [[0,'maj','I'],[2,'min','ii'],[4,'dim','iii°'],[5,'maj','IV'],[7,'min','v'],[9,'min','vi'],[10,'maj','VII']],
    // 5: Aeolian (Natural Minor)
    [[0,'min','i'],[2,'dim','ii°'],[3,'maj','III'],[5,'min','iv'],[7,'min','v'],[8,'maj','VI'],[10,'maj','VII']],
    // 6: Locrian
    [[0,'dim','i°'],[1,'maj','II'],[3,'min','iii'],[5,'min','iv'],[6,'maj','V'],[8,'maj','VI'],[10,'min','vii']],
    // 7: Major Pentatonic
    [[0,'maj','I'],[2,'min','ii'],[4,'min','iii'],[7,'maj','V'],[9,'min','vi']],
    // 8: Minor Pentatonic
    [[0,'min','i'],[3,'maj','III'],[5,'min','iv'],[7,'min','v'],[10,'maj','VII']],
    // 9: Blues Pentatonic
    [[0,'min','i'],[3,'maj','III'],[5,'min','iv'],[7,'min','v'],[10,'maj','VII']],
    // 10: Harmonic Minor
    [[0,'min','i'],[2,'dim','ii°'],[3,'aug','III+'],[5,'min','iv'],[7,'maj','V'],[8,'maj','VI'],[11,'dim','vii°']],
];

const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const QUALITY_SUFFIX: Record<ChordQuality, string> = { maj: '', min: 'm', dim: '°', aug: '+' };

function chordName(rootMidi: number, quality: ChordQuality): string {
    return NOTE_NAMES[((rootMidi % 12) + 12) % 12] + QUALITY_SUFFIX[quality];
}

/**
 * Finds the best guitar voicing for a chord given the open-string tuning.
 */
function findVoicing(rootMidi: number, quality: ChordQuality, tuning: number[]): (number | null)[] {
    const chordClasses = CHORD_INTERVALS[quality].map(i => ((rootMidi + i) % 12 + 12) % 12);
    const rootClass = ((rootMidi % 12) + 12) % 12;

    let bestVoicing: (number | null)[] = tuning.map(() => null);
    let bestScore = -1;

    for (let ws = 0; ws <= 12; ws++) {
        const we = ws === 0 ? 4 : ws + 3;
        const voicing: (number | null)[] = [];
        let score = 0;
        let hasRoot = false;

        for (let si = 0; si < tuning.length; si++) {
            const open = tuning[si];
            let placed = false;

            if (ws === 0) {
                const oc = ((open % 12) + 12) % 12;
                if (chordClasses.includes(oc)) {
                    voicing.push(0);
                    score++;
                    if (oc === rootClass) hasRoot = true;
                    placed = true;
                }
            }

            if (!placed) {
                const startFret = ws === 0 ? 1 : ws;
                for (let f = startFret; f <= we; f++) {
                    const nc = ((open + f) % 12 + 12) % 12;
                    if (chordClasses.includes(nc)) {
                        voicing.push(f);
                        score++;
                        if (nc === rootClass) hasRoot = true;
                        placed = true;
                        break;
                    }
                }
            }

            if (!placed) voicing.push(null);
        }

        const total = score + (hasRoot ? 2 : 0);
        if (total > bestScore) {
            bestScore = total;
            bestVoicing = voicing;
        }
    }

    return bestVoicing;
}

export function getChordsForScale(keySig: number, scaleIndex: number, tuning: number[]): ChordDefinition[] {
    const degrees = SCALE_DEGREES[scaleIndex] ?? SCALE_DEGREES[0];
    return degrees.map(([offset, quality, numeral]) => {
        const rootMidi = keySig + offset;
        return {
            rootMidi,
            quality,
            name: chordName(rootMidi, quality),
            numeral,
            voicing: findVoicing(rootMidi, quality, tuning),
        };
    });
}

// ── All-chords library ────────────────────────────────────────────────────────

export function getAllChords(tuning: number[]): { quality: ChordQuality; label: string; chords: ChordDefinition[] }[] {
    const qualities: { quality: ChordQuality; label: string }[] = [
        { quality: 'maj', label: 'Major' },
        { quality: 'min', label: 'Minor' },
        { quality: 'dim', label: 'Dim' },
        { quality: 'aug', label: 'Aug' },
    ];
    return qualities.map(({ quality, label }) => ({
        quality,
        label,
        chords: Array.from({ length: 12 }, (_, i) => {
            const rootMidi = 48 + i;
            return {
                rootMidi,
                quality,
                name: chordName(rootMidi, quality),
                numeral: '',
                voicing: findVoicing(rootMidi, quality, tuning),
            };
        }),
    }));
}

// ── Chord progressions ────────────────────────────────────────────────────────

export interface ProgressionStep {
    offset: number;
    quality: ChordQuality;
    numeral: string;
}

export interface ChordProgression {
    name: string;
    genre: string;
    chords: ProgressionStep[];
}

export const COMMON_PROGRESSIONS: ChordProgression[] = [
    {
        name: 'I – IV – V',
        genre: 'Blues / Rock',
        chords: [
            { offset: 0, quality: 'maj', numeral: 'I' },
            { offset: 5, quality: 'maj', numeral: 'IV' },
            { offset: 7, quality: 'maj', numeral: 'V' },
        ],
    },
    {
        name: 'I – V – vi – IV',
        genre: 'Pop',
        chords: [
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 7,  quality: 'maj', numeral: 'V' },
            { offset: 9,  quality: 'min', numeral: 'vi' },
            { offset: 5,  quality: 'maj', numeral: 'IV' },
        ],
    },
    {
        name: 'I – vi – IV – V',
        genre: '50s / Doo-Wop',
        chords: [
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 9,  quality: 'min', numeral: 'vi' },
            { offset: 5,  quality: 'maj', numeral: 'IV' },
            { offset: 7,  quality: 'maj', numeral: 'V' },
        ],
    },
    {
        name: 'ii – V – I',
        genre: 'Jazz',
        chords: [
            { offset: 2,  quality: 'min', numeral: 'ii' },
            { offset: 7,  quality: 'maj', numeral: 'V' },
            { offset: 0,  quality: 'maj', numeral: 'I' },
        ],
    },
    {
        name: 'I – IV – vi – V',
        genre: 'Pop Rock',
        chords: [
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 5,  quality: 'maj', numeral: 'IV' },
            { offset: 9,  quality: 'min', numeral: 'vi' },
            { offset: 7,  quality: 'maj', numeral: 'V' },
        ],
    },
    {
        name: 'i – VII – VI – VII',
        genre: 'Rock (Minor)',
        chords: [
            { offset: 0,  quality: 'min', numeral: 'i' },
            { offset: 10, quality: 'maj', numeral: 'VII' },
            { offset: 8,  quality: 'maj', numeral: 'VI' },
            { offset: 10, quality: 'maj', numeral: 'VII' },
        ],
    },
    {
        name: 'i – iv – VII – III',
        genre: 'Minor',
        chords: [
            { offset: 0,  quality: 'min', numeral: 'i' },
            { offset: 5,  quality: 'min', numeral: 'iv' },
            { offset: 10, quality: 'maj', numeral: 'VII' },
            { offset: 3,  quality: 'maj', numeral: 'III' },
        ],
    },
    {
        name: 'i – VI – III – VII',
        genre: 'Minor Pop',
        chords: [
            { offset: 0,  quality: 'min', numeral: 'i' },
            { offset: 8,  quality: 'maj', numeral: 'VI' },
            { offset: 3,  quality: 'maj', numeral: 'III' },
            { offset: 10, quality: 'maj', numeral: 'VII' },
        ],
    },
    {
        name: 'I – III – IV – iv',
        genre: 'Maj → Min',
        chords: [
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 4,  quality: 'maj', numeral: 'III' },
            { offset: 5,  quality: 'maj', numeral: 'IV' },
            { offset: 5,  quality: 'min', numeral: 'iv' },
        ],
    },
    {
        name: 'I – IV – I – V',
        genre: 'Country',
        chords: [
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 5,  quality: 'maj', numeral: 'IV' },
            { offset: 0,  quality: 'maj', numeral: 'I' },
            { offset: 7,  quality: 'maj', numeral: 'V' },
        ],
    },
];

export function getProgressionChords(
    keySig: number,
    progression: ChordProgression,
    tuning: number[]
): ChordDefinition[] {
    return progression.chords.map(step => {
        const rootMidi = keySig + step.offset;
        return {
            rootMidi,
            quality: step.quality,
            name: chordName(rootMidi, step.quality),
            numeral: step.numeral,
            voicing: findVoicing(rootMidi, step.quality, tuning),
        };
    });
}
