/**
 * Setlist store — manages live performance setlist state.
 *
 * Types and store extracted from setlistUseCases.ts to follow the pattern
 * of stores living in the stores/ folder, not inside use case files.
 */

import { createStore } from '#/infra/store/createStore';

export type SetlistItem = {
    id: string;
    /** Song/cue name */
    name: string;
    /** Project file path to load (null = stays in current project) */
    projectPath: string | null;
    /** BPM for this item (null = use project tempo) */
    bpm: number | null;
    /** Time signature */
    timeSignature: { numerator: number; denominator: number } | null;
    /** Duration in seconds (estimated, for display) */
    estimatedDuration: number;
    /** Notes (stage directions, reminders) */
    notes: string;
    /** MIDI program change to send on item start */
    programChange: { channel: number; program: number } | null;
    /** Color label */
    color: string;
    /** Auto-stop after this item finishes */
    autoStop: boolean;
    /** Gap in seconds before next item auto-starts */
    gapSeconds: number;
    /** Custom markers within this setlist item (beat positions) */
    markers: Array<{ beatOffset: number; name: string }>;
};

export type SetlistState = {
    name: string;
    items: SetlistItem[];
    currentIndex: number;
    /** Is the setlist playing through automatically? */
    autoAdvance: boolean;
    /** Count-in bars before each item */
    countInBars: number;
};

export const setlistStore = createStore<SetlistState>({
    initialData: {
        name: 'Untitled Setlist',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
    },
});
