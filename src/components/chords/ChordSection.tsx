import React, { useState } from 'react';
import './ChordSection.css';
import { ChordDiagram } from './ChordDiagram';
import { getChordsForScale, getAllChords } from '../../models/chords';
import { GuitarService, SoundMode } from '../../services/guitar.service';
import { Constants } from '../../models/constants';

type DisplayMode = 'scale' | 'maj' | 'min' | 'dim' | 'aug';

interface IChordSection {
    keySig: number;
    scaleIndex: number;
    tuning: number[];
    guitarService: GuitarService;
    soundMode: SoundMode;
}

const TABS: { id: DisplayMode; label: string }[] = [
    { id: 'scale', label: 'Scale'   },
    { id: 'maj',   label: 'Major'   },
    { id: 'min',   label: 'Minor'   },
    { id: 'dim',   label: 'Dim'     },
    { id: 'aug',   label: 'Aug'     },
];

export function ChordSection({ keySig, scaleIndex, tuning, guitarService, soundMode }: IChordSection) {
    const [mode, setMode] = useState<DisplayMode>('scale');

    const keyName  = Constants.keys().find(k => k.key === keySig)?.value ?? '';
    const scaleName = Constants.modes()[scaleIndex]?.value ?? '';

    let chords;
    if (mode === 'scale') {
        chords = getChordsForScale(keySig, scaleIndex, tuning);
    } else {
        const groups = getAllChords(tuning);
        chords = groups.find(g => g.quality === mode)!.chords;
    }

    return (
        <div className="chord-section">
            <div className="chord-section-top">
                <span className="chord-section-label">{keyName} {scaleName}</span>
                <div className="chord-tabs">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            className={`chord-tab${mode === t.id ? ' active' : ''}`}
                            onClick={() => setMode(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="chord-scroll-row">
                {chords.map((chord, i) => (
                    <ChordDiagram
                        key={i}
                        chord={chord}
                        tuning={tuning}
                        guitarService={guitarService}
                        soundMode={soundMode}
                    />
                ))}
            </div>
        </div>
    );
}
