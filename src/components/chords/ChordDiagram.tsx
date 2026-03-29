import React from 'react';
import './ChordDiagram.css';
import { ChordDefinition } from '../../models/chords';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IChordDiagram {
    chord: ChordDefinition;
    tuning: number[];
    guitarService: GuitarService;
    soundMode: SoundMode;
}

export class ChordDiagram extends React.Component<IChordDiagram> {
    strum = () => {
        const { chord, tuning, guitarService, soundMode } = this.props;
        guitarService.audioContext.resume().then(() => {
            chord.voicing.forEach((fret, stringIndex) => {
                if (fret !== null) {
                    const midiNote = tuning[stringIndex] + fret;
                    setTimeout(() => {
                        guitarService.playNote(midiNote, soundMode);
                    }, stringIndex * 35);
                }
            });
        });
    };

    render() {
        const { chord, tuning } = this.props;
        const { voicing, name, numeral, rootMidi } = chord;
        const numStrings = voicing.length;
        const rootClass = ((rootMidi % 12) + 12) % 12;

        // Determine the display window: find the lowest non-open fretted note
        const frettedAboveNut = voicing.filter((f): f is number => f !== null && f > 0);
        const minFret = frettedAboveNut.length > 0 ? Math.min(...frettedAboveNut) : 1;
        const windowStart = minFret <= 1 ? 1 : minFret;
        const showNut = windowStart === 1;
        const numRows = 4;

        const cellWidth = 22;
        const gridWidth = numStrings * cellWidth;

        return (
            <div className="chord-diagram" onClick={this.strum} title={`Strum ${name}`}>
                <div className="chord-name">{name}</div>
                <div className="chord-numeral">{numeral}</div>

                {/* Open / muted string indicators */}
                <div className="chord-indicators" style={{ width: gridWidth }}>
                    {voicing.map((fret, i) => (
                        <div key={i} className="chord-indicator">
                            {fret === null ? '×' : fret === 0 ? '○' : ''}
                        </div>
                    ))}
                </div>

                {/* Nut or fret position label */}
                {showNut
                    ? <div className="chord-nut" style={{ width: gridWidth }} />
                    : <div className="chord-fret-label" style={{ width: gridWidth }}>{windowStart}fr</div>
                }

                {/* Fret grid */}
                <div
                    className="chord-grid"
                    style={{
                        gridTemplateColumns: `repeat(${numStrings}, ${cellWidth}px)`,
                        width: gridWidth,
                    }}
                >
                    {Array.from({ length: numRows }, (_, row) => {
                        const fretNum = windowStart + row;
                        return voicing.map((fret, si) => {
                            const hasDot = fret === fretNum;
                            const isRoot = hasDot && (((tuning[si] + (fret ?? 0)) % 12 + 12) % 12) === rootClass;
                            const cls = hasDot
                                ? isRoot ? 'chord-cell root' : 'chord-cell dot'
                                : 'chord-cell';
                            return <div key={`${row}-${si}`} className={cls} />;
                        });
                    })}
                </div>
            </div>
        );
    }
}
