import { type ReactElement, type RefObject } from 'react';

import { setNoteProbability } from '#/modules/MIDI/useCases';
import { DEFAULT_NOTE_PROBABILITY } from '#/utils/midiData';

import { NotePropertyLane } from './NotePropertyLane';

type ProbabilityLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    /** Scroll container the lane is laid out inside — see `NotePropertyLane`. */
    scrollRef: RefObject<HTMLElement | null>;
};

const getProbability = (note: { probability?: number }): number => note.probability ?? DEFAULT_NOTE_PROBABILITY;

export const ProbabilityLane = (props: ProbabilityLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getProbability}
        setValue={setNoteProbability}
        label="Probability"
        undoLabel="Change probability"
    />
);
