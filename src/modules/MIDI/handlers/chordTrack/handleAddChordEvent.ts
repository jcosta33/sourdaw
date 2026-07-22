import { createHandler } from '#/utils/createHandler';

import { type ChordType, CHORD_TYPES } from '../../models/ChordTypes';
import { addChordEvent } from '../../useCases/chordTrack/addChordEvent';

import { describeChordTrackMutation } from './handleRestoreChordTrackState';

function isChordType(value: string): value is ChordType {
    return Object.prototype.hasOwnProperty.call(CHORD_TYPES, value);
}

type AddChordEventAction = { payload: { eventId?: string } };

function ensureEventId(action: AddChordEventAction): string {
    if (!action.payload.eventId) {
        action.payload.eventId = `chord-${crypto.randomUUID()}`;
    }
    return action.payload.eventId;
}

export const handleAddChordEvent = createHandler<'addChordEvent'>({
    execute: (alpha) => {
        const quality: ChordType = isChordType(alpha.payload.quality) ? alpha.payload.quality : 'major';
        const root = Math.max(0, Math.min(11, Math.round(alpha.payload.root)));
        const beat = Math.max(0, alpha.payload.beat);
        const duration = alpha.payload.duration ?? 4;
        addChordEvent(beat, root, quality, duration, ensureEventId(alpha));
    },
    describe: (alpha) => {
        ensureEventId(alpha);
        return describeChordTrackMutation(alpha, `Add ${alpha.payload.quality} chord at beat ${alpha.payload.beat}`);
    },
    undoable: true,
});
