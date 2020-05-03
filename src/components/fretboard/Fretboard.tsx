import React from 'react';
import { Note } from '../note/Note';
import './Fretboard.css';
import { Modes } from '../../models/modes';
import { GuitarService } from '../../services/guitar.service';

interface IFretboard { numOfFrets: number, keySig: number, mode: number };

export class Fretboard extends React.Component<IFretboard> {
  guitarService = new GuitarService();

  createFretBoard(count: number): Array<any> {
    const rows = new Array<any>();
    let rowCount = 0;
    let i = 52;

    while (i < count + 52) {
      rows.push(this.createRow(i, rowCount++));
      i++;
    }

    return rows;
  }

  isMarked(note: number): boolean {
    const mode = Modes.all()[this.props.mode]
    for (let i = 0; i < mode.length; i++) {
      const interval = (this.props.keySig + mode[i]);
      
      // isOctave covers all intervals of the fretboard relative to defined notes.
      const isOctave = (note - 12 === interval || note + 12 === interval 
        || note - 24 === interval || note + 24 === interval 
        || note - 36 === interval || note + 36 === interval);

      if (note === interval || isOctave ) {
        return true;
      }
    }

    return false;
  }

  createRow(n: number, count: number): any {
    const intervals = [n, n + 5, n + 10, n + 15, n + 19, n + 24];

    const notes = intervals.map((interval, key) =>
      <div className='col' key={ key }>
        <div className='string'></div>
        <Note value={ interval } marked={ this.isMarked(interval) } guitarService={ this.guitarService }></Note>
        <div className='string'></div>
      </div>
    );

    return (
      <div className={ count !== 0 ? 'grid' : 'nut' } key={ n }>
        <div className={ count !== 0 ? 'binding' : 'no-binding' } >{ count }</div>
        { notes }
        <div className={ count !== 0 ? 'binding' : 'no-binding' }>{ count }</div>
      </div>
    );
  }

  render() {
    return (
      <div className='fretboard'>
        { this.createFretBoard(this.props.numOfFrets) }
      </div>
    );
  }
}
