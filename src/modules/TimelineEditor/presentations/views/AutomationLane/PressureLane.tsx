import { type ReactElement, type RefObject } from 'react';

import { setNotePressure } from '#/modules/MIDI/useCases';

import { NotePropertyLane } from './NotePropertyLane';

type PressureLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    /** Scroll container the lane is laid out inside — see `NotePropertyLane`. */
    scrollRef: RefObject<HTMLElement | null>;
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
