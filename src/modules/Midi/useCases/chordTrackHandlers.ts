import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import {
    addChordEvent,
    removeChordEvent,
    toggleChordTrack,
    clearChordTrack,
} from '#/modules/MIDI/useCases/chordTrackUseCases';
import { type ChordType, CHORD_TYPES } from '#/modules/MIDI/useCases/chordStamps';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

const VALID_CHORD_QUALITIES = new Set(Object.keys(CHORD_TYPES));

export const chordTrackHandlers = {
    addChordEvent: {
        execute: (a) => {
            const quality = VALID_CHORD_QUALITIES.has(a.payload.quality)
                ? (a.payload.quality as ChordType)
                : 'major';
            const root = Math.max(0, Math.min(11, Math.round(a.payload.root)));
            const beat = Math.max(0, a.payload.beat);
            const duration = a.payload.duration ?? 4;
            addChordEvent(beat, root, quality, duration);
        },
        describe: (a) => ({ label: `Add ${a.payload.quality} chord at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addChordEvent'>>,

    removeChordEvent: {
        execute: (a) => {
            removeChordEvent(a.payload.eventId);
        },
        describe: () => ({ label: 'Remove chord event' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeChordEvent'>>,

    toggleChordTrack: {
        execute: (a) => {
            toggleChordTrack(a.payload?.enabled);
        },
        describe: () => ({ label: 'Toggle chord track' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleChordTrack'>>,

    clearChordTrack: {
        execute: () => {
            clearChordTrack();
        },
        describe: () => ({ label: 'Clear chord track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'clearChordTrack'>>,
};
