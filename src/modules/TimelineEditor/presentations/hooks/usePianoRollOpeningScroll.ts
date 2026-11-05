import { type RefObject, useLayoutEffect, useRef } from 'react';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { getPianoRollOpeningScroll } from '../helpers/pianoRollOpeningScroll';

type Options = {
    scrollRef: RefObject<HTMLDivElement | null>;
    clipId: string;
    notes: readonly MidiNote[];
    visiblePitches: readonly number[];
    beatWidth: number;
};

type OpeningState = { clipId: string; settled: boolean; appliedWithoutNotes: boolean };

/**
 * Scrolls the roll onto the clip's notes once per opened clip. Returns
 * `settle`, which the component calls on any user input so nothing the user
 * does afterwards (scrolling, drawing) is followed by a view jump, and
 * `isOpeningScroll`, which the scroll handler uses to tell our own scroll
 * event from the user's.
 *
 * A clip opened with no notes is applied again once, if notes arrive for the
 * same clip before the user touched the roll: the note store can fill after
 * the editor mounts.
 */
export const usePianoRollOpeningScroll = ({ scrollRef, clipId, notes, visiblePitches, beatWidth }: Options) => {
    const stateRef = useRef<OpeningState | null>(null);
    const appliedRef = useRef<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        if (stateRef.current?.clipId !== clipId) {
            stateRef.current = { clipId, settled: false, appliedWithoutNotes: false };
        }
        const state = stateRef.current;
        const viewport = scrollRef.current;
        if (state.settled || viewport === null) {
            return;
        }
        if (state.appliedWithoutNotes && notes.length === 0) {
            return;
        }
        const target = getPianoRollOpeningScroll({
            notes,
            visiblePitches,
            viewportHeight: viewport.clientHeight,
            viewportWidth: viewport.clientWidth,
            scrollLeft: viewport.scrollLeft,
            beatWidth,
        });
        if (target === null) {
            return;
        }
        viewport.scrollTop = target.scrollTop;
        if (target.scrollLeft !== null) {
            viewport.scrollLeft = target.scrollLeft;
        }
        appliedRef.current = { top: viewport.scrollTop, left: viewport.scrollLeft };
        state.settled = notes.length > 0;
        state.appliedWithoutNotes = notes.length === 0;
    });

    const settle = (): void => {
        if (stateRef.current !== null) {
            stateRef.current.settled = true;
        }
    };

    const isOpeningScroll = (viewport: HTMLElement): boolean =>
        appliedRef.current?.top === viewport.scrollTop && appliedRef.current.left === viewport.scrollLeft;

    return { settle, isOpeningScroll };
};
