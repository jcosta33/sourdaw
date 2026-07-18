import { type ReactElement } from 'react';

import { setNoteProbability } from '#/modules/MIDI/useCases';

import { NotePropertyLane } from './NotePropertyLane';

type ProbabilityLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

const getProbability = (note: { probability?: number }): number => note.probability ?? 100;

export const ProbabilityLane = (props: ProbabilityLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getProbability}
        setValue={setNoteProbability}
        label="Probability"
        undoLabel="Change probability"
    />
);
