export class Modes {
    static all(): Array<Array<number>> {
        return [
            this.ionian(),
            this.dorian(),
            this.phyrgian(),
            this.lydian(),
            this.mixolydian(),
            this.aeolian(),
            this.locrian()
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
}
