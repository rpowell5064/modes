import React from 'react';
import './Note.css';
import { NoteNames } from '../../models/noteNames';
import { GuitarService, SoundMode } from '../../services/guitar.service';
import classNames from 'classnames';

interface INote { value: number, marked?: boolean, keySig: number, guitarService: GuitarService, soundMode: SoundMode, showPattern?: boolean, playing?: boolean }

export class Note extends React.Component<INote> {

    handleClick = () => {
        this.props.guitarService.audioContext.resume().then(() => {
            this.props.guitarService.playNote(this.props.value, this.props.soundMode);
        });
    }

    render() {
        const classes = classNames('note', {
            'marked':  this.props.marked,
            'pattern': this.props.marked && this.props.showPattern,
            'octave':  NoteNames.get(this.props.value) === NoteNames.get(this.props.keySig),
            'playing': this.props.playing,
        });

        const noteName = NoteNames.get(this.props.value);
        return <div className={ classes } onClick={ this.handleClick } title={ noteName }>{ noteName }</div>
    }
}
