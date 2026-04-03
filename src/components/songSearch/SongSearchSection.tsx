import React, { useState, useEffect, useMemo } from 'react';
import songsData from '../../data/songs.json';
import './SongSearchSection.css';

// ── Music-theory lookup tables ──────────────────────────────────────────────

const KEY_TO_MIDI: Record<string, number> = {
    'C': 48, 'C#': 49, 'Db': 49, 'D': 50, 'D#': 51, 'Eb': 51,
    'E': 52, 'F': 53, 'F#': 54, 'Gb': 54, 'G': 55, 'G#': 56,
    'Ab': 56, 'A': 57, 'A#': 58, 'Bb': 58, 'B': 59,
};

const MODE_TO_INDEX: Record<string, number> = {
    'ionian': 0, 'major': 0,
    'dorian': 1,
    'phrygian': 2,
    'lydian': 3,
    'mixolydian': 4,
    'aeolian': 5, 'natural minor': 5, 'minor': 5,
    'locrian': 6,
    'major pentatonic': 7,
    'minor pentatonic': 8,
    'blues pentatonic': 9, 'blues': 9,
    'harmonic minor': 10,
};

const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

const MODE_INTERVALS: Record<string, number[]> = {
    'ionian':           [0, 2, 4, 5, 7, 9, 11],
    'dorian':           [0, 2, 3, 5, 7, 9, 10],
    'phrygian':         [0, 1, 3, 5, 7, 8, 10],
    'lydian':           [0, 2, 4, 6, 7, 9, 11],
    'mixolydian':       [0, 2, 4, 5, 7, 9, 10],
    'aeolian':          [0, 2, 3, 5, 7, 8, 10],
    'locrian':          [0, 1, 3, 5, 6, 8, 10],
    'major pentatonic': [0, 2, 4, 7, 9],
    'minor pentatonic': [0, 3, 5, 7, 10],
    'blues pentatonic': [0, 3, 5, 6, 7, 10],
    'harmonic minor':   [0, 2, 3, 5, 7, 8, 11],
};

const ALL_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function computeScaleNotes(key: string, mode: string): string {
    const intervals = MODE_INTERVALS[mode.toLowerCase()] ?? MODE_INTERVALS['ionian'];
    const rootIdx = ALL_NOTES.indexOf(key);
    if (rootIdx === -1) return '';
    return intervals.map(i => ALL_NOTES[(rootIdx + i) % 12]).join(' ');
}

// ── Types ───────────────────────────────────────────────────────────────────

interface SongRecord {
    title: string;
    artist: string;
    key: string;
    mode: string;
    sections: { name: string; chords: string[] }[];
}

export interface SongApplyPayload {
    keySig: number;
    modeIndex: number;
    tuning: number[];
    numStrings: number;
    song: { title: string; artist: string; chords: string[] };
}

interface ISongSearchSection {
    onApply:        (payload: SongApplyPayload) => void;
    appliedSong?:   { title: string; artist: string } | null;
    onClearApplied?: () => void;
}

// ── Search helpers ───────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
    return s.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Every query token must appear somewhere in the target string. */
function tokenMatch(target: string, tokens: string[]): boolean {
    const t = target.toLowerCase();
    return tokens.every(tok => t.includes(tok));
}

function matchScore(song: SongRecord, sqTokens: string[], aqTokens: string[]): number {
    let score = 0;
    if (sqTokens.length) {
        const t  = song.title.toLowerCase();
        const sq = sqTokens.join(' ');
        if (t === sq)                        score += 10;
        else if (t.startsWith(sq))           score += 6;
        else if (t.includes(sq))             score += 4;
        else if (tokenMatch(t, sqTokens))    score += 2;
    }
    if (aqTokens.length) {
        const a  = song.artist.toLowerCase();
        const aq = aqTokens.join(' ');
        if (a === aq)                        score += 10;
        else if (a.startsWith(aq))           score += 6;
        else if (a.includes(aq))             score += 4;
        else if (tokenMatch(a, aqTokens))    score += 2;
    }
    return score;
}

// ── Component ───────────────────────────────────────────────────────────────

export function SongSearchSection({ onApply, appliedSong, onClearApplied }: ISongSearchSection) {
    const songs = songsData as SongRecord[];
    const [songQ,    setSongQ]    = useState('');
    const [artistQ,  setArtistQ]  = useState('');
    const [dSongQ,   setDSongQ]   = useState('');
    const [dArtistQ, setDArtistQ] = useState('');
    const [selected, setSelected] = useState<SongRecord | null>(null);
    const [showList, setShowList] = useState(false);

    // Debounce search queries by 250 ms
    useEffect(() => {
        const t = setTimeout(() => setDSongQ(songQ), 250);
        return () => clearTimeout(t);
    }, [songQ]);
    useEffect(() => {
        const t = setTimeout(() => setDArtistQ(artistQ), 250);
        return () => clearTimeout(t);
    }, [artistQ]);

    // Filtered + ranked results (uses debounced queries)
    const results = useMemo<SongRecord[]>(() => {
        const sqTokens = tokenize(dSongQ);
        const aqTokens = tokenize(dArtistQ);
        if (!sqTokens.length && !aqTokens.length) return [];

        return songs
            .filter(s => {
                const titleMatch  = !sqTokens.length || tokenMatch(s.title,  sqTokens);
                const artistMatch = !aqTokens.length || tokenMatch(s.artist, aqTokens);
                return titleMatch && artistMatch;
            })
            .map(s => ({ s, score: matchScore(s, sqTokens, aqTokens) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 15)
            .map(x => x.s);
    }, [songs, dSongQ, dArtistQ]);

    function selectSong(song: SongRecord) {
        setSelected(song);
        setShowList(false);
        setSongQ(song.title);
        setArtistQ(song.artist);
    }

    function handleQueryChange(field: 'song' | 'artist', val: string) {
        if (field === 'song') setSongQ(val);
        else setArtistQ(val);
        setSelected(null);
        setShowList(true);
    }

    function handleApply() {
        if (!selected) return;
        const chords = selected.sections
            .flatMap(s => s.chords)
            .filter(c => c && c !== '.');
        onApply({
            keySig:     KEY_TO_MIDI[selected.key]                  ?? KEY_TO_MIDI['A'],
            modeIndex:  MODE_TO_INDEX[selected.mode.toLowerCase()] ?? 0,
            tuning:     STANDARD_TUNING,
            numStrings: 6,
            song:       { title: selected.title, artist: selected.artist, chords },
        });
    }

    function handleClear() {
        onClearApplied?.();
        setSelected(null);
        setSongQ('');
        setArtistQ('');
    }

    const scaleNotes  = selected ? computeScaleNotes(selected.key, selected.mode) : '';
    const hasQuery    = songQ.trim().length > 0 || artistQ.trim().length > 0;
    const isApplied   = !!appliedSong && !!selected && appliedSong.title === selected.title;

    return (
        <div className="song-search-section">

            {/* Header */}
            <div className="ss-header">
                <span className="ss-title">Song Lookup</span>
                {songs.length > 0 && (
                    <span className="ss-db-count">{songs.length.toLocaleString()} songs</span>
                )}
            </div>

            {/* Active song banner */}
            {appliedSong && (
                <div className="ss-active-bar">
                    <span className="ss-active-label">Active</span>
                    <span className="ss-active-title">{appliedSong.title}</span>
                    <span className="ss-active-artist">{appliedSong.artist}</span>
                    <button className="ss-clear-btn" onClick={handleClear}>Clear</button>
                </div>
            )}


            {/* Search inputs */}
            <div className="ss-search-wrap">
                <div className="ss-search-row">
                    <input
                        className="ss-input ss-song-input"
                        type="text"
                        placeholder="Song title"
                        value={songQ}
                        onChange={e => handleQueryChange('song', e.currentTarget.value)}
                        onFocus={() => results.length > 0 && setShowList(true)}
                        onBlur={() => setTimeout(() => setShowList(false), 150)}
                        autoComplete="off"
                    />
                    <input
                        className="ss-input ss-artist-input"
                        type="text"
                        placeholder="Artist"
                        value={artistQ}
                        onChange={e => handleQueryChange('artist', e.currentTarget.value)}
                        onFocus={() => results.length > 0 && setShowList(true)}
                        onBlur={() => setTimeout(() => setShowList(false), 150)}
                        autoComplete="off"
                    />
                </div>

                {/* Results dropdown */}
                {showList && results.length > 0 && (
                    <div className="ss-results-list">
                        {results.map((s, i) => (
                            <button key={i} className="ss-result-row" onMouseDown={() => selectSong(s)}>
                                <span className="ss-result-row-title">{s.title}</span>
                                <span className="ss-result-row-artist">{s.artist}</span>
                            </button>
                        ))}
                    </div>
                )}

                {showList && hasQuery && results.length === 0 && songs.length > 0 && (
                    <div className="ss-no-results">No songs found</div>
                )}
            </div>

            {/* Selected song card */}
            {selected && (
                <div className="ss-result">

                    <div className="ss-result-header">
                        <div className="ss-result-title">
                            <span className="ss-result-song">{selected.title}</span>
                            <span className="ss-result-sep"> — </span>
                            <span className="ss-result-artist">{selected.artist}</span>
                        </div>
                    </div>

                    <div className="ss-result-grid">
                        <div className="ss-result-block">
                            <span className="ss-block-label">Key + Mode</span>
                            <span className="ss-block-value">{selected.key} {selected.mode}</span>
                        </div>
                        <div className="ss-result-block">
                            <span className="ss-block-label">Tuning</span>
                            <span className="ss-block-value">Standard</span>
                        </div>
                        {scaleNotes && (
                            <div className="ss-result-block ss-result-block--scale">
                                <span className="ss-block-label">Scale Notes</span>
                                <span className="ss-block-value ss-scale">{scaleNotes}</span>
                            </div>
                        )}
                    </div>

                    {selected.sections.length > 0 && (
                        <div className="ss-sections">
                            <span className="ss-block-label">Chord Progression</span>
                            {selected.sections.map((sec, i) => (
                                <div key={i} className="ss-section">
                                    <span className="ss-section-name">{sec.name}</span>
                                    <div className="ss-section-chords">
                                        {sec.chords.map((c, ci) => (
                                            <span key={ci} className="ss-chord-pill">{c}</span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="ss-actions">
                        {isApplied ? (
                            <button className="ss-clear-btn ss-clear-btn--full" onClick={handleClear}>
                                Clear Song
                            </button>
                        ) : (
                            <button className="ss-apply-btn" onClick={handleApply}>
                                Apply to Fretboard
                            </button>
                        )}
                    </div>

                </div>
            )}

        </div>
    );
}
