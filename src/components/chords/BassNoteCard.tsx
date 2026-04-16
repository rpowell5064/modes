import React from 'react';
import './BassNoteCard.css';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IBassNoteCard {
    noteName:  string;       // e.g. "A"
    numeral:   string;       // e.g. "i", "IV"
    midi:      number;       // absolute MIDI note to play
    stringName: string;      // open-string name, e.g. "E"
    fret:      number;       // fret on that string
    guitarService: GuitarService;
    soundMode: SoundMode;
    active?:   boolean;
}

export function BassNoteCard({ noteName, numeral, midi, stringName, fret, guitarService, soundMode, active }: IBassNoteCard) {
    function handleClick() {
        guitarService.audioContext.resume().then(() => {
            const ctx = guitarService.audioContext;
            const t   = ctx.currentTime + 0.01;
            guitarService.playNoteAt(midi, soundMode, t, 1.2, 0.9);
        });
    }

    return (
        <div
            className={`bass-note-card${active ? ' bass-note-card--active' : ''}`}
            onClick={handleClick}
            title={`${noteName} — ${stringName} string, fret ${fret}`}
        >
            <span className="bnc-name">{noteName}</span>
            {numeral && <span className="bnc-numeral">{numeral}</span>}
            <span className="bnc-pos">
                {fret === 0 ? 'Open' : `Fret ${fret}`}
                <span className="bnc-string"> · {stringName}</span>
            </span>
        </div>
    );
}
