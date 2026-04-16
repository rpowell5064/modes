import React from 'react';
import './App.css';
import { Fretboard } from './components/fretboard/Fretboard';
import { ChordSection } from './components/chords/ChordSection';
import { ProgressionSection } from './components/chords/ProgressionSection';
import { SongSearchSection, SongApplyPayload } from './components/songSearch/SongSearchSection';
import { MetronomeSection } from './components/metronome/MetronomeSection';
import { TunerSection } from './components/tuner/TunerSection';
import { TabPage } from './components/tab/TabPage';
import { Constants } from './models/constants';
import { GuitarService } from './services/guitar.service';
import { NoteNames } from './models/noteNames';
import {
    TimeSig, NoteLength,
    ALL_TIME_SIGS, TIME_SIG_GROUPS,
    NOTE_LENGTH_OPTIONS, NOTE_LENGTH_LABEL,
    DEFAULT_BPM, DEFAULT_NOTE_LEN,
} from './models/playback';

interface IMode { keySig: number, mode: number };
interface SongOverride {
    title:  string;
    artist: string;
    chords: string[];
}

type AppPage = 'modes' | 'tab';

interface IModeState {
    activePage:      AppPage;
    keySig:          number;
    mode:            number;
    instrumentKey:   string;
    tuning:          number[];
    showPattern:     boolean;
    bpm:             number;
    timeSig:         TimeSig;
    noteLength:      NoteLength;
    toolsPanelOpen:  boolean;
    metronomeActive: boolean;
    toolsBeat:       boolean;
    songOverride:    SongOverride | null;
}

const DEFAULT_TUNINGS: Record<string, number[]> = {
  'guitar-6': [40, 45, 50, 55, 59, 64],
  'guitar-7': [35, 40, 45, 50, 55, 59, 64],
  'guitar-8': [30, 35, 40, 45, 50, 55, 59, 64],
  'bass-4':   [28, 33, 38, 43],
  'bass-5':   [23, 28, 33, 38, 43],
  'bass-6':   [23, 28, 33, 38, 43, 48],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function getClosestMidi(noteClass: number, reference: number): number {
  const refClass = ((reference % 12) + 12) % 12;
  let diff = noteClass - refClass;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return reference + diff;
}

export default class App extends React.Component<{}, IModeState> {
  private guitarService    = new GuitarService();
  private beatFlashTimer: number | null = null;

  constructor(props: IMode) {
    super(props);
    this.state = {
      activePage:      'modes',
      keySig:          57,
      mode:            0,
      instrumentKey:   'guitar-6',
      tuning:          DEFAULT_TUNINGS['guitar-6'],
      showPattern:     true,
      bpm:             DEFAULT_BPM,
      timeSig:         ALL_TIME_SIGS[0],
      noteLength:      DEFAULT_NOTE_LEN,
      toolsPanelOpen:  false,
      metronomeActive: false,
      toolsBeat:       false,
      songOverride:    null,
    } as IModeState;
  }

  handleKeySigChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ keySig: +event.currentTarget.value });
  }

  handleModeChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ mode: +event.currentTarget.value });
  }

  handleStringsChange(event: React.FormEvent<HTMLSelectElement>): void {
    const instrumentKey = event.currentTarget.value;
    this.setState({ instrumentKey, tuning: DEFAULT_TUNINGS[instrumentKey] });
  }

  handleTuningChange(stringIndex: number, noteClass: number): void {
    const tuning = [...this.state.tuning];
    tuning[stringIndex] = getClosestMidi(noteClass, tuning[stringIndex]);
    this.setState({ tuning });
  }

  handleTuningShift(delta: number): void {
    this.setState({ tuning: this.state.tuning.map(midi => midi + delta) });
  }

  handleSongApply(payload: SongApplyPayload): void {
    this.setState({
      keySig:        payload.keySig,
      mode:          payload.modeIndex,
      tuning:        payload.tuning,
      instrumentKey: 'guitar-' + payload.numStrings,
      songOverride:  payload.song,
    });
  }

  handleMetronomeBeat(): void {
    if (this.beatFlashTimer !== null) window.clearTimeout(this.beatFlashTimer);
    this.setState({ toolsBeat: true });
    this.beatFlashTimer = window.setTimeout(() => {
      this.setState({ toolsBeat: false });
      this.beatFlashTimer = null;
    }, 120);
  }

  render() {
    const keys = Constants.keys().map((note, key) => (
      <option value={ note.key } key={ key }>{ note.value }</option>
    ));

    const modes = Constants.modes().map((mode, key) => (
      <option value={ mode.key } key={ key }>{ mode.value }</option>
    ));

    const noteOptions = NOTE_NAMES.map((name, noteClass) => (
      <option value={ noteClass } key={ noteClass }>{ name }</option>
    ));

    const tuningSelectors = this.state.tuning.map((midiVal, idx) => (
      <select
        key={ idx }
        value={ ((midiVal % 12) + 12) % 12 }
        onChange={ (e) => this.handleTuningChange(idx, +e.currentTarget.value) }
        className='tuning-select'
      >
        { noteOptions }
      </select>
    ));

    const { activePage, bpm, timeSig, noteLength, toolsPanelOpen, metronomeActive, toolsBeat } = this.state;

    return (
      <div className="App">

        <nav className="app-nav">
          <div className="nav-brand">
            <span className="nav-icon">🎸</span>
            <span className="nav-title">Fretboard</span>
          </div>

          {/* Page switcher */}
          <div className="nav-pages">
            <button
              className={`nav-page-btn${activePage === 'modes' ? ' nav-page-btn--active' : ''}`}
              onClick={() => this.setState({ activePage: 'modes' })}
            >
              Modes
            </button>
            <button
              className={`nav-page-btn${activePage === 'tab' ? ' nav-page-btn--active' : ''}`}
              onClick={() => this.setState({ activePage: 'tab' })}
            >
              Tab Editor
            </button>
          </div>

          <div className="nav-controls">
            <div className="nav-control-group">
              <button
                type='button'
                className={`button${toolsPanelOpen ? ' active' : ''}${metronomeActive && !toolsPanelOpen ? ' button--metro-on' : ''}${toolsBeat && !toolsPanelOpen ? ' button--beat' : ''}`}
                onClick={ () => this.setState(s => ({ toolsPanelOpen: !s.toolsPanelOpen })) }
                title='Metronome & Tuner'
              >
                🎛 Tools
              </button>
            </div>
            <div className="nav-control-group">
              <label className="nav-label" htmlFor='key-select'>Key</label>
              <select id='key-select' value={ this.state.keySig } onChange={ this.handleKeySigChange.bind(this) }>
                { keys }
              </select>
            </div>
            <div className="nav-control-group">
              <label className="nav-label" htmlFor='mode-select'>Scale</label>
              <select id='mode-select' value={ this.state.mode } onChange={ this.handleModeChange.bind(this) }>
                { modes }
              </select>
            </div>
            <div className="nav-control-group">
              <label className="nav-label" htmlFor='strings-select'>Instrument</label>
              <select id='strings-select' value={ this.state.instrumentKey } onChange={ this.handleStringsChange.bind(this) }>
                <optgroup label="Guitar">
                  <option value="guitar-6">Guitar 6</option>
                  <option value="guitar-7">Guitar 7</option>
                  <option value="guitar-8">Guitar 8</option>
                </optgroup>
                <optgroup label="Bass">
                  <option value="bass-4">Bass 4</option>
                  <option value="bass-5">Bass 5</option>
                  <option value="bass-6">Bass 6</option>
                </optgroup>
              </select>
            </div>
            <div className="nav-control-group">
              <button
                type='button'
                className={`button${this.state.showPattern ? ' active' : ''}`}
                onClick={ () => this.setState(s => ({ showPattern: !s.showPattern })) }
                title='Scale pattern overlay'
              >
                Pattern
              </button>
            </div>
            <div className="nav-control-group">
              <button
                type='button'
                className='button'
                onClick={ () => window.print() }
                title='Export as PDF via browser print dialog'
              >
                PDF
              </button>
            </div>
          </div>
        </nav>

        {/* ── Tab Editor page ──────────────────────────────────────────── */}
        {activePage === 'tab' && (
          <TabPage
            tuning={ this.state.tuning }
            guitarService={ this.guitarService }
          />
        )}

        {/* ── Modes page ───────────────────────────────────────────────── */}
        {activePage === 'modes' && (<>

          {/* Print-only title */}
          <div className="print-title">
            <span className="print-title-key">
              {NoteNames.get(this.state.keySig)} {Constants.modes().find(m => m.key === this.state.mode)?.value}
            </span>
            <span className="print-title-tuning">
              Tuning: {this.state.tuning.map(n => NoteNames.get(n)).join(' · ')}
            </span>
          </div>

          <div className="fretboard-area">
            <Fretboard
              numOfFrets={ 22 }
              keySig={ this.state.keySig }
              mode={ this.state.mode }
              tuning={ this.state.tuning }
              soundMode='clean'
              guitarService={ this.guitarService }
              showPattern={ this.state.showPattern }
              bpm={ this.state.bpm }
              timeSig={ this.state.timeSig }
              noteLength={ this.state.noteLength }
            />
          </div>

          {/* Portal target for Scale Playback controls — outside horizontal scroll */}
          <div id="scale-ctrl-root" />

          {/* Shared playback controls — one set for the whole page */}
          <div className="playback-bar">
            <div className="playback-bar-body">

              {/* Left: time-based controls */}
              <div className="playback-time-col">
                <span className="playback-bar-title">Global Playback</span>
                <div className="playback-controls-row">
                  <div className="playback-bpm-group">
                    <label className="playback-label">BPM</label>
                    <input
                      type="range"
                      className="playback-bpm-slider"
                      min={40} max={240} step={1}
                      value={bpm}
                      onChange={e => this.setState({ bpm: +e.currentTarget.value })}
                    />
                    <span className="playback-bpm-value">{bpm}</span>
                  </div>
                  <div className="playback-note-length-group">
                    <label className="playback-label">Note</label>
                    {NOTE_LENGTH_OPTIONS.map(nl => (
                      <button
                        key={nl}
                        className={`playback-nl-btn${noteLength === nl ? ' playback-nl-btn--active' : ''}`}
                        onClick={() => this.setState({ noteLength: nl })}
                      >
                        {NOTE_LENGTH_LABEL[nl]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="playback-timesig-area">
                  {TIME_SIG_GROUPS.map((group, gi) => (
                    <div key={gi} className="playback-ts-group">
                      <span className="playback-ts-category">{group.category}</span>
                      <div className="playback-ts-btns">
                        {group.sigs.map(ts => (
                          <button
                            key={ts.label}
                            className={`playback-ts-btn${timeSig.label === ts.label ? ' playback-ts-btn--active' : ''}`}
                            onClick={() => this.setState({ timeSig: ts })}
                            title={`${ts.beats} beat${ts.beats !== 1 ? 's' : ''} per measure`}
                          >
                            {ts.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: tuning */}
              <div className="playback-tuning-col">
                <span className="playback-label">Tuning</span>
                <div className="playback-tuning-row">
                  <button className="playback-tuning-shift-btn" onClick={() => this.handleTuningShift(-1)} title="Tune down a half step">♭</button>
                  { tuningSelectors }
                  <button className="playback-tuning-shift-btn" onClick={() => this.handleTuningShift(+1)} title="Tune up a half step">♯</button>
                </div>
              </div>

            </div>{/* end playback-bar-body */}
          </div>

          {/* ── Slide-out Tools Panel ─────────────────────────────────── */}
          <div
            className={`tools-panel-overlay${toolsPanelOpen ? ' tools-panel-overlay--open' : ''}`}
            onClick={ () => this.setState({ toolsPanelOpen: false }) }
          />
          <div className={`tools-panel${toolsPanelOpen ? ' tools-panel--open' : ''}`}>
            <div className="tools-panel-header">
              <span className="tools-panel-title">Tools</span>
              <button
                className="tools-panel-close"
                onClick={ () => this.setState({ toolsPanelOpen: false }) }
                aria-label="Close tools panel"
              >✕</button>
            </div>
            <MetronomeSection
              guitarService={this.guitarService}
              bpm={bpm}
              timeSig={timeSig}
              onPlayingChange={ active => this.setState({ metronomeActive: active }) }
              onBeat={ this.handleMetronomeBeat.bind(this) }
            />
            <TunerSection     guitarService={this.guitarService} tuning={this.state.tuning} />
          </div>

          <SongSearchSection
            onApply={ this.handleSongApply.bind(this) }
            appliedSong={ this.state.songOverride }
            onClearApplied={ () => this.setState({ songOverride: null }) }
          />

          <ProgressionSection
            keySig={ this.state.keySig }
            tuning={ this.state.tuning }
            guitarService={ this.guitarService }
            soundMode='clean'
            bpm={bpm}
            timeSig={timeSig}
            noteLength={noteLength}
            songOverride={ this.state.songOverride ?? undefined }
            onClearSong={ () => this.setState({ songOverride: null }) }
          />

          <ChordSection
            keySig={ this.state.keySig }
            scaleIndex={ this.state.mode }
            tuning={ this.state.tuning }
            guitarService={ this.guitarService }
            soundMode='clean'
          />

        </>)}

      </div>
    );
  }
}
