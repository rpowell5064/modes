export class NoteNames {
    static get(note: number) {
        switch(note) {
            case 36:
            case 48:
            case 60:
            case 72:
            case 84:
            case 96:
                return 'C';
            case 37:
            case 49:
            case 61:
            case 73:
            case 85:
            case 97:
                return 'C#';
            case 38:
            case 50:
            case 62:
            case 74:
            case 86:
            case 98:
                return 'D';
            case 39:
            case 51:
            case 63:
            case 75:
            case 87:
            case 99:
                return 'Eb';
            case 40:
            case 52:
            case 64:
            case 76:
            case 88:
            case 100:
                return 'E'
            case 41:
            case 53:
            case 65:
            case 77:
            case 89:
            case 101:
                return 'F';
            case 42:
            case 54:
            case 66:
            case 78:
            case 90:
            case 102:
                return 'F#';
            case 43:
            case 55:
            case 67:
            case 79:
            case 91:
            case 103:
                return 'G';
            case 44:
            case 56:
            case 68:
            case 80:
            case 92:
            case 104:
                return 'Ab'
            case 45:
            case 57:
            case 69:
            case 81:
            case 93:
            case 105:
                return 'A';
            case 46:
            case 58:
            case 70:
            case 82:
            case 94:
            case 106:
                return 'Bb';
            case 47:
            case 59:
            case 71:
            case 83:
            case 95:
            case 107:
                return 'B';
        }
    }
}