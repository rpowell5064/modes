import React from 'react';
import './Note.css';
import { NoteNames } from '../../models/noteNames';
import { GuitarService } from '../../services/guitar.service';
import 'classnames';
import classNames from 'classnames';

interface INote { value: number, marked?: boolean, guitarService: GuitarService }

export class Note extends React.Component<INote> {

    playNote(note: number): void {
        this.props.guitarService.audioContext.resume().then(() => {
            const guitarSound = this.props.guitarService.getFilterNodeByNoteNumber(note);
            guitarSound.connect(this.props.guitarService.audioContext.destination);
        });
    }

    handleClick = () => {
        this.playNote(this.props.value);
    }

    render() {
        const classes = classNames('note', { marked: this.props.marked });
        const noteName = NoteNames.get(this.props.value);
        return <div className={ classes } onClick={ this.handleClick } title={ noteName }>{ noteName }</div>
    }
}
