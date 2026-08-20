import { type ReactElement, type RefObject } from 'react';

import { setNoteVelocity, setNoteVelocities } from '#/modules/MIDI/useCases';

import { NotePropertyLane } from './NotePropertyLane';

type VelocityLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    /** Scroll container the lane is laid out inside — see `NotePropertyLane`. */
    scrollRef: RefObject<HTMLElement | null>;
};

const getVelocity = (note: { velocity: number }): number => note.velocity;

export const VelocityLane = (props: VelocityLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getVelocity}
        setValue={setNoteVelocity}
        setValues={setNoteVelocities}
        label="Velocity"
        undoLabel="Change velocity"
    />
);
