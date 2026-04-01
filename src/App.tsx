import React from 'react';
import './App.css';
import { Fretboard } from './components/fretboard/Fretboard';
import { ChordSection } from './components/chords/ChordSection';
import { ProgressionSection } from './components/chords/ProgressionSection';
import { MetronomeSection } from './components/metronome/MetronomeSection';
import { TunerSection } from './components/tuner/TunerSection';
import { Constants } from './models/constants';
import { GuitarService } from './services/guitar.service';
import { NoteNames } from './models/noteNames';

interface IMode { keySig: number, mode: number };
interface IModeState { keySig: number, mode: number, numOfStrings: number, tuning: number[], showPattern: boolean };

const DEFAULT_TUNINGS: Record<number, number[]> = {
  6: [40, 45, 50, 55, 59, 64],
  7: [35, 40, 45, 50, 55, 59, 64],
  8: [30, 35, 40, 45, 50, 55, 59, 64],
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
  private guitarService = new GuitarService();

  constructor(props: IMode) {
    super(props);
    this.state = {
      keySig: 57,
      mode: 0,
      numOfStrings: 6,
      tuning: DEFAULT_TUNINGS[6],
      showPattern: true,
    } as IModeState;
  }

  handleKeySigChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ keySig: +event.currentTarget.value });
  }

  handleModeChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ mode: +event.currentTarget.value });
  }

  handleStringsChange(event: React.FormEvent<HTMLSelectElement>): void {
    const numOfStrings = +event.currentTarget.value;
    this.setState({ numOfStrings, tuning: DEFAULT_TUNINGS[numOfStrings] });
  }

  handleTuningChange(stringIndex: number, noteClass: number): void {
    const tuning = [...this.state.tuning];
    tuning[stringIndex] = getClosestMidi(noteClass, tuning[stringIndex]);
    this.setState({ tuning });
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

    return (
      <div className="App">

        <nav className="app-nav">
          <div className="nav-brand">
            <span className="nav-icon">🎸</span>
            <span className="nav-title">Fretboard</span>
          </div>
          <div className="nav-controls">
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
              <label className="nav-label" htmlFor='strings-select'>Strings</label>
              <select id='strings-select' value={ this.state.numOfStrings } onChange={ this.handleStringsChange.bind(this) }>
                <option value={ 6 }>6</option>
                <option value={ 7 }>7</option>
                <option value={ 8 }>8</option>
              </select>
            </div>
            <div className="nav-control-group">
              <button
                type='button'
                className={`button${this.state.showPattern ? ' active' : ''}`}
                onClick={ () => this.setState(s => ({ showPattern: !s.showPattern })) }
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

        {/* Print-only title — hidden on screen, shows key + scale in exported PDF */}
        <div className="print-title">
          <span className="print-title-key">
            {NoteNames.get(this.state.keySig)} {Constants.modes().find(m => m.key === this.state.mode)?.value}
          </span>
          <span className="print-title-tuning">
            Tuning: {this.state.tuning.map(n => NoteNames.get(n)).join(' · ')}
          </span>
        </div>

        <div className='tuning-bar'>
          <span className='drop-down-label'>Tuning:</span>
          { tuningSelectors }
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
          />
        </div>

        <div className="tools-row">
          <MetronomeSection guitarService={this.guitarService} />
          <TunerSection     guitarService={this.guitarService} />
        </div>

        <ProgressionSection
          keySig={ this.state.keySig }
          tuning={ this.state.tuning }
          guitarService={ this.guitarService }
          soundMode='clean'
        />

        <ChordSection
          keySig={ this.state.keySig }
          scaleIndex={ this.state.mode }
          tuning={ this.state.tuning }
          guitarService={ this.guitarService }
          soundMode='clean'
        />

      </div>
    );
  }
}
