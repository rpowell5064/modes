import React from 'react';
import './App.css';
import { Fretboard } from './components/fretboard/Fretboard';
import { Constants } from './models/constants';

interface IMode { keySig: number, mode: number };
interface IModeState { keySig: number, mode: number };

export default class App extends React.Component<{}, IModeState> {

  constructor (props: IMode) {
    super(props);
    
    // default A Ionian
    this.state = {
      keySig: 57,
      mode: 0
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

  rotate(): void {
    const fretboard = document.getElementsByClassName('fretboard')[0];

    if (fretboard && !fretboard.classList.contains('horizontal')) {
      fretboard.classList.add('horizontal');
    } else {
      fretboard.classList.remove('horizontal');
    }
  }

  handleKeySigChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ keySig: +event.currentTarget.value });
  }

  handleModeChange(event: React.FormEvent<HTMLSelectElement>): void {
    this.setState({ mode: +event.currentTarget.value });
  }

  render() {
    const keys = Constants.keys().map((note, key) => {
      return <option value={ note.key } key={ key }>{ note.value }</option>
    });

    const modes = Constants.modes().map((mode, key) => {
      return <option value={ mode.key } key={ key }>{ mode.value }</option>
    });

    // todo: move ul to nav component and create select list components.
    return (
      <div className="App">
        <ul>
          <li>
            <label htmlFor='key-select'>
              Key:
              <select id='key-select' value={ this.state.keySig } onChange={ this.handleKeySigChange.bind(this) }>
                { keys }
              </select>
            </label>
          </li>
          <li>
            <label htmlFor='mode-select'>
              Mode:
              <select id='mode-select' value={ this.state.mode } onChange={ this.handleModeChange.bind(this) }>
                { modes }
              </select>
            </label>
          </li>
          <li>
            <button id='rotate-button' type='button' className='button' onClick={ this.rotate }>Rotate</button>
          </li>
          <li>
            <button type='button' className='button' onClick={ this.perspective }>Perspective</button>
          </li>
        </ul>
        <Fretboard 
          numOfFrets={ 23 } 
          keySig={ this.state.keySig } 
          mode={ this.state.mode }>
        </Fretboard>
      </div>
    );
  };
}
