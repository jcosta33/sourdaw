import { type ReactElement, type RefObject } from 'react';

import { setNoteSlide } from '#/modules/MIDI/useCases';

import { NotePropertyLane } from './NotePropertyLane';

type SlideLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    /** Scroll container the lane is laid out inside — see `NotePropertyLane`. */
    scrollRef: RefObject<HTMLElement | null>;
};

const getSlide = (note: { slide?: number }): number => note.slide ?? 0;

const getSlideCurve = (note: { expression?: { slide?: { offsetBeats: number; value: number }[] } }) =>
    note.expression?.slide;

export const SlideLane = (props: SlideLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getSlide}
        getCurve={getSlideCurve}
        setValue={setNoteSlide}
        label="Slide"
        undoLabel="Change slide"
    />
);
