const NOTE_NAMES_MAP = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export class NoteNames {
    static get(note: number): string {
        return NOTE_NAMES_MAP[((note % 12) + 12) % 12];
    }
}
