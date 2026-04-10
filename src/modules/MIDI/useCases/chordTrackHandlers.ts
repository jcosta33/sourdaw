import { addChordEvent } from './chordTrack/addChordEvent';
import { removeChordEvent } from './chordTrack/removeChordEvent';
import { toggleChordTrack } from './chordTrack/toggleChordTrack';
import { clearChordTrack } from './chordTrack/clearChordTrack';
import { type ChordType, CHORD_TYPES } from './chordStamps';

type ChordTrackHandlerDescription = {
    label: string;
};

type ChordTrackHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ChordTrackHandlerDescription;
    undoable: boolean;
};

type ChordTrackAction =
    | { type: 'addChordEvent'; payload: { quality: string; root: number; beat: number; duration?: number } }
    | { type: 'removeChordEvent'; payload: { eventId: string } }
    | { type: 'toggleChordTrack'; payload?: { enabled?: boolean } }
    | { type: 'clearChordTrack'; payload?: undefined };

type ChordTrackActionOf<ActionType extends ChordTrackAction['type']> = Extract<
    ChordTrackAction,
    { type: ActionType }
>;

type ChordTrackHandlers = {
    addChordEvent: ChordTrackHandler<ChordTrackActionOf<'addChordEvent'>>;
    removeChordEvent: ChordTrackHandler<ChordTrackActionOf<'removeChordEvent'>>;
    toggleChordTrack: ChordTrackHandler<ChordTrackActionOf<'toggleChordTrack'>>;
    clearChordTrack: ChordTrackHandler<ChordTrackActionOf<'clearChordTrack'>>;
};

const VALID_CHORD_QUALITIES = new Set(Object.keys(CHORD_TYPES));

export const chordTrackHandlers: ChordTrackHandlers = {
    addChordEvent: {
        execute: (a) => {
            const quality = VALID_CHORD_QUALITIES.has(a.payload.quality) ? (a.payload.quality as ChordType) : 'major';
            const root = Math.max(0, Math.min(11, Math.round(a.payload.root)));
            const beat = Math.max(0, a.payload.beat);
            const duration = a.payload.duration ?? 4;
            addChordEvent(beat, root, quality, duration);
        },
        describe: (a) => ({ label: `Add ${a.payload.quality} chord at beat ${a.payload.beat}` }),
        undoable: true,
    },

    removeChordEvent: {
        execute: (a) => {
            removeChordEvent(a.payload.eventId);
        },
        describe: () => ({ label: 'Remove chord event' }),
        undoable: true,
    },

    toggleChordTrack: {
        execute: (a) => {
            toggleChordTrack(a.payload?.enabled);
        },
        describe: () => ({ label: 'Toggle chord track' }),
        undoable: false,
    },

    clearChordTrack: {
        execute: () => {
            clearChordTrack();
        },
        describe: () => ({ label: 'Clear chord track' }),
        undoable: true,
    },
};
