import { type MidiNote } from '../../models/MidiNoteViewTypes';

import {
    PITCH_RAIL_WIDTH,
    ROW_HEIGHT,
    RULER_HEIGHT,
    getPianoRollContentHeight,
    getPianoRollRowTop,
} from './pianoRollConstants';

/** Middle C, the pitch an empty clip opens centred on (every DAW's default). */
const MIDDLE_C_PITCH = 60;
/** Gap kept between the pitch rail and the earliest note when scrolling to it. */
const LEFT_MARGIN_PX = 8;

type OpeningScrollInput = {
    notes: readonly Pick<MidiNote, 'pitch' | 'startBeat'>[];
    /** Pitches top to bottom, as `getVisiblePitches` returns them. */
    visiblePitches: readonly number[];
    viewportHeight: number;
    viewportWidth: number;
    scrollLeft: number;
    beatWidth: number;
};

export type OpeningScroll = {
    scrollTop: number;
    /** `null` when the earliest note is already in view: leave the horizontal scroll alone. */
    scrollLeft: number | null;
};

const nearestRow = (visiblePitches: readonly number[], pitch: number): number => {
    let best = 0;
    for (let row = 1; row < visiblePitches.length; row++) {
        if (Math.abs(visiblePitches[row]! - pitch) < Math.abs(visiblePitches[best]! - pitch)) {
            best = row;
        }
    }
    return best;
};

/**
 * Where the piano roll should scroll when a clip is opened so its notes are in
 * view, or `null` when the viewport has no usable size yet.
 *
 * The notes' row span is centred in the area below the ruler; a span taller
 * than that area is anchored with its highest note just under the ruler. A
 * clip with no notes (with a row) is centred on middle C.
 */
export const getPianoRollOpeningScroll = (input: OpeningScrollInput): OpeningScroll | null => {
    const { notes, visiblePitches, viewportHeight, viewportWidth, scrollLeft, beatWidth } = input;
    if (!(viewportHeight > 0) || !(viewportWidth > 0) || visiblePitches.length === 0) {
        return null;
    }

    const rowOfPitch = new Map(visiblePitches.map((pitch, row) => [pitch, row]));
    const shown = notes.filter((note) => rowOfPitch.has(note.pitch));
    const rows = shown.map((note) => rowOfPitch.get(note.pitch)!);
    const highestRow = shown.length > 0 ? Math.min(...rows) : nearestRow(visiblePitches, MIDDLE_C_PITCH);
    const lowestRow = shown.length > 0 ? Math.max(...rows) : highestRow;

    const spanTop = getPianoRollRowTop(highestRow);
    const spanBottom = getPianoRollRowTop(lowestRow) + ROW_HEIGHT;
    const areaHeight = viewportHeight - RULER_HEIGHT;
    const wanted =
        spanBottom - spanTop > areaHeight
            ? spanTop - RULER_HEIGHT
            : (spanTop + spanBottom) / 2 - (viewportHeight + RULER_HEIGHT) / 2;
    const maxScrollTop = Math.max(0, getPianoRollContentHeight(visiblePitches.length) - viewportHeight);
    const scrollTop = Math.min(maxScrollTop, Math.max(0, wanted));

    const earliestX = shown.length > 0 ? Math.min(...shown.map((note) => note.startBeat)) * beatWidth : null;
    const visibleWidth = viewportWidth - PITCH_RAIL_WIDTH;
    const inView = earliestX === null || (earliestX >= scrollLeft && earliestX < scrollLeft + visibleWidth);
    return { scrollTop, scrollLeft: inView ? null : Math.max(0, earliestX - LEFT_MARGIN_PX) };
};
