import { type ReactElement } from 'react';
import { setNotePressure } from '#/modules/MIDI/useCases/midiEvent';
import { NotePropertyLane } from './NotePropertyLane';

type PressureLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

const getPressure = (note: { pressure?: number }): number => note.pressure ?? 0;

export const PressureLane = (props: PressureLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getPressure}
        setValue={setNotePressure}
        label="Pressure"
        undoLabel="Change pressure"
    />
);
