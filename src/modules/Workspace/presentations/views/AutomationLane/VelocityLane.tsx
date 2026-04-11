import { type ReactElement } from 'react';
import { setNoteVelocity } from '#/modules/MIDI/useCases';
import { NotePropertyLane } from './NotePropertyLane';

type VelocityLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

const getVelocity = (note: { velocity: number }): number => note.velocity;

export const VelocityLane = (props: VelocityLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getVelocity}
        setValue={setNoteVelocity}
        label="Velocity"
        undoLabel="Change velocity"
    />
);
