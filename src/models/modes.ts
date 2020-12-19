export class Modes {
    static all(): Array<Array<number>> {
        return [
            this.ionian(),
            this.dorian(),
            this.phyrgian(),
            this.lydian(),
            this.mixolydian(),
            this.aeolian(),
            this.locrian(),
            this.majorPentatonic(),
            this.minorPentatonic(),
            this.bluesPentatonic(),
            this.harmonicMinor()
        ];
    }

    static ionian(): Array<number> {
        // w w h w w w h
        return [0, 2, 4, 5, 7, 9, 11, 12];
    }

    static dorian(): Array<number> {
        // w h w w w h w
        return [0, 2, 3, 5, 7, 9, 10, 12];
    }

    static phyrgian(): Array<number> {
        // h w w w h w w
        return [0, 1, 3, 5, 7, 8, 10, 12];
    }

    static lydian(): Array<number> {
        // w w w h w w h
        return [0, 2, 4, 6, 7, 9, 11, 12];
    }

    static mixolydian(): Array<number> {
        // w w h w w h w
        return [0, 2, 4, 5, 7, 9, 10, 12];
    }

    static aeolian(): Array<number> {
        // w h w w h w w
        return [0, 2, 3, 5, 7, 8, 10, 12];
    }

    static locrian(): Array<number> {
        // h w w h w w w
        return [0, 1, 3, 5, 6, 8, 10, 12];
    }

    static majorPentatonic(): Array<number> {
        // 1 - 2 - 3 - 5 - 6
        return [0, 2, 4, 7, 9, 12];
    }

    static minorPentatonic(): Array<number> {
        // 1 - b3 - 4 - 5 - b7
        return [0, 3, 5, 7, 10, 12];
    }

    static bluesPentatonic(): Array<number> {
        return [0, 3, 5, 6, 7, 10, 12];
    }

    static harmonicMinor(): Array<number> {
        return [0, 2, 3, 5, 7, 8, 11, 12];
    }
}
