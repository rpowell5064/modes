/* ── Shared playback types and constants ─────────────────────────────────── */

export type NoteLength =
    | 'thirtysecond'
    | 'sixteenth'
    | 'eighth'
    | 'quarter'
    | 'half'
    | 'whole'
    | 'sixteenth-triplet'
    | 'eighth-triplet'
    | 'quarter-triplet'
    | 'sextuplet';

export const NOTE_LENGTH_BEATS: Record<NoteLength, number> = {
    thirtysecond:        0.125,
    sixteenth:           0.25,
    eighth:              0.50,
    quarter:             1.00,
    half:                2.00,
    whole:               4.00,
    'sixteenth-triplet': 1 / 6,
    'eighth-triplet':    1 / 3,
    'quarter-triplet':   2 / 3,
    sextuplet:           1 / 6,
};

export const NOTE_LENGTH_OPTIONS: NoteLength[] = [
    'thirtysecond', 'sixteenth', 'eighth', 'quarter', 'half', 'whole',
    'sixteenth-triplet', 'eighth-triplet', 'quarter-triplet', 'sextuplet',
];

export const NOTE_LENGTH_LABEL: Record<NoteLength, string> = {
    thirtysecond:        '1/32',
    sixteenth:           '1/16',
    eighth:              '1/8',
    quarter:             '1/4',
    half:                '1/2',
    whole:               '1/1',
    'sixteenth-triplet': '1/16t',
    'eighth-triplet':    '1/8t',
    'quarter-triplet':   '1/4t',
    sextuplet:           '1/6',
};

export interface TimeSig {
    label:     string;
    beats:     number;
    beatDurQN: number;
}

export const TIME_SIG_GROUPS: { category: string; sigs: TimeSig[] }[] = [
    {
        category: 'Simple',
        sigs: [
            { label: '4/4',  beats: 4, beatDurQN: 1.0 },
            { label: 'C',    beats: 4, beatDurQN: 1.0 },
            { label: '2/2',  beats: 2, beatDurQN: 2.0 },
            { label: '2/4',  beats: 2, beatDurQN: 1.0 },
            { label: '3/4',  beats: 3, beatDurQN: 1.0 },
        ],
    },
    {
        category: 'Compound',
        sigs: [
            { label: '6/8',  beats: 2, beatDurQN: 1.5 },
            { label: '9/8',  beats: 3, beatDurQN: 1.5 },
            { label: '12/8', beats: 4, beatDurQN: 1.5 },
            { label: '3/8',  beats: 1, beatDurQN: 1.5 },
        ],
    },
    {
        category: 'Irregular',
        sigs: [
            { label: '5/4',  beats: 5, beatDurQN: 1.0 },
            { label: '7/4',  beats: 7, beatDurQN: 1.0 },
            { label: '7/8',  beats: 7, beatDurQN: 0.5 },
        ],
    },
];

export const ALL_TIME_SIGS    = TIME_SIG_GROUPS.flatMap(g => g.sigs);
export const DEFAULT_TIME_SIG = ALL_TIME_SIGS[0]; // 4/4
export const DEFAULT_BPM      = 110;
export const DEFAULT_NOTE_LEN: NoteLength = 'whole';
export const LOOKAHEAD_S      = 0.30;
export const TICK_MS          = 100;
