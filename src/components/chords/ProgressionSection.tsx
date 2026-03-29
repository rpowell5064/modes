import React from 'react';
import './ProgressionSection.css';
import { ChordDiagram } from './ChordDiagram';
import { COMMON_PROGRESSIONS, getProgressionChords } from '../../models/chords';
import { GuitarService, SoundMode } from '../../services/guitar.service';

interface IProgressionSection {
    keySig: number;
    tuning: number[];
    guitarService: GuitarService;
    soundMode: SoundMode;
}

export function ProgressionSection({ keySig, tuning, guitarService, soundMode }: IProgressionSection) {
    return (
        <div className="progression-section">
            <div className="progression-section-header">Chord Progressions</div>
            <div className="progression-cards">
                {COMMON_PROGRESSIONS.map((prog, i) => {
                    const chords = getProgressionChords(keySig, prog, tuning);

                    const strumAll = () => {
                        guitarService.audioContext.resume().then(() => {
                            chords.forEach((chord, ci) => {
                                chord.voicing.forEach((fret, si) => {
                                    if (fret !== null) {
                                        setTimeout(() => {
                                            guitarService.playNote(tuning[si] + fret, soundMode);
                                        }, ci * 900 + si * 35);
                                    }
                                });
                            });
                        });
                    };

                    return (
                        <div key={i} className="prog-card">
                            <div className="prog-card-header">
                                <div className="prog-card-meta">
                                    <span className="prog-card-name">{prog.name}</span>
                                    <span className="prog-card-genre">{prog.genre}</span>
                                </div>
                                <button
                                    className="prog-play-btn"
                                    onClick={strumAll}
                                    title="Play progression"
                                >
                                    ▶
                                </button>
                            </div>
                            <div className="prog-card-chords">
                                {chords.map((chord, ci) => (
                                    <ChordDiagram
                                        key={ci}
                                        chord={chord}
                                        tuning={tuning}
                                        guitarService={guitarService}
                                        soundMode={soundMode}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
