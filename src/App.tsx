import React from 'react';
import './App.css';
import { Fretboard } from './components/fretboard/Fretboard';
import { ChordSection } from './components/chords/ChordSection';
import { ProgressionSection } from './components/chords/ProgressionSection';
import { Constants } from './models/constants';
import { GuitarService, SoundMode } from './services/guitar.service';

interface IMode { keySig: number, mode: number };
interface IModeState { keySig: number, mode: number, numOfStrings: number, tuning: number[], soundMode: SoundMode };

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
      soundMode: 'clean',
    } as IModeState;
  }

  perspective(): void {
    const fretboard = document.getElementsByClassName('fretboard')[0];
    if (fretboard && !fretboard.classList.contains('perspective')) {
      fretboard.classList.add('perspective');
    } else {
      fretboard.classList.remove('perspective');
    }
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

  handleSoundModeChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ soundMode: event.currentTarget.value as SoundMode });
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
              <label className="nav-label" htmlFor='sound-select'>Sound</label>
              <select id='sound-select' value={ this.state.soundMode } onChange={ this.handleSoundModeChange.bind(this) }>
                <option value='clean'>Clean</option>
                <option value='distorted'>Distorted</option>
              </select>
            </div>
            <div className="nav-control-group">
              <label className="nav-label" htmlFor='strings-select'>Strings</label>
              <select id='strings-select' value={ this.state.numOfStrings } onChange={ this.handleStringsChange.bind(this) }>
                <option value={ 6 }>6 String</option>
                <option value={ 7 }>7 String</option>
                <option value={ 8 }>8 String</option>
              </select>
            </div>
            <div className="nav-control-group" id="perspective-group">
              <button id="perspective-button" type='button' className='button' onClick={ this.perspective }>
                Perspective
              </button>
            </div>
          </div>
        </nav>

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
            soundMode={ this.state.soundMode }
            guitarService={ this.guitarService }
          />
        </div>

        <ChordSection
          keySig={ this.state.keySig }
          scaleIndex={ this.state.mode }
          tuning={ this.state.tuning }
          guitarService={ this.guitarService }
          soundMode={ this.state.soundMode }
        />

        <ProgressionSection
          keySig={ this.state.keySig }
          tuning={ this.state.tuning }
          guitarService={ this.guitarService }
          soundMode={ this.state.soundMode }
        />

      </div>
    );
  }
}
