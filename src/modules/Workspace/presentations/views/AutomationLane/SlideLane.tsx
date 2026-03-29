import { type ReactElement } from 'react';
import { setNoteSlide } from '#/modules/MIDI/useCases/midiEvent';
import { NotePropertyLane } from './NotePropertyLane';

type SlideLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

const getSlide = (note: { slide?: number }): number => note.slide ?? 0;

export const SlideLane = (props: SlideLaneProps): ReactElement => (
    <NotePropertyLane
        {...props}
        getValue={getSlide}
        setValue={setNoteSlide}
        label="Slide"
        undoLabel="Change slide"
    />
);
