import { KeyValue } from "./keyValue";

export class Constants {
    static keys(): Array<KeyValue> {
        return [
            {
                key: 48,
                value: 'C'
            },
            {
                key: 49,
                value: 'C#'
            }, {
                key: 50,
                value: 'D'
            },
            {
                key: 51,
                value: 'Eb'
            },
            {
                key: 52,
                value: 'E'
            },
            {
                key: 53,
                value: 'F'
            },
            {
                key: 54,
                value: 'F#'
            },
            {
                key: 55,
                value: 'G'
            },
            {
                key: 56,
                value: 'Ab'
            },
            {
                key: 57,
                value: 'A'
            },
            {
                key: 58,
                value: 'Bb'
            },
            {
                key: 59,
                value: 'B'
            }
        ];
    }

    static modes(): Array<KeyValue> {
        return [
            {
                key: 0,
                value: 'Ionian'
            },
            {
                key: 1,
                value: 'Dorian'
            },
            {
                key: 2,
                value: 'Phyrgian'
            },
            {
                key: 3,
                value: 'Lydian'
            },
            {
                key: 4,
                value: 'Mixolydian'
            },
            {
                key: 5,
                value: 'Aeolian'
            },
            {
                key: 6,
                value: 'Locrian'
            }
        ];
    }
}
