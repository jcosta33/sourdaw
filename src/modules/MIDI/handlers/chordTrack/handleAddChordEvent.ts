import { createHandler } from '#/utils/createHandler';

import { type ChordType, CHORD_TYPES } from '../../models/ChordTypes';
import { findChordEventArgumentRefusal } from '../../transformers/findChordEventArgumentRefusal';
import { addChordEvent } from '../../useCases/chordTrack/addChordEvent';

import {
    describeChordTrackMutation,
    findChordTrackRefusal,
    isChordTrackMutationNoop,
    isChordTrackSessionEntry,
} from './handleRestoreChordTrackState';

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
        // A lone dispatch is not validated first, so refuse here rather than store a value the track rejects.
        const refusal = findChordEventArgumentRefusal(alpha.payload);
        const { quality } = alpha.payload;
        if (refusal !== null || !isChordType(quality)) {
            throw new Error(refusal ?? `Chord quality "${quality}" is not a known chord quality`);
        }
        addChordEvent(
            alpha.payload.beat,
            alpha.payload.root,
            quality,
            alpha.payload.duration ?? 4,
            ensureEventId(alpha)
        );
    },
    describe: (alpha, context) => {
        ensureEventId(alpha);
        return describeChordTrackMutation(
            alpha,
            `Add ${alpha.payload.quality} chord at beat ${alpha.payload.beat}`,
            context
        );
    },
    validate: (action, context) => findChordTrackRefusal(action, context) === null,
    validationRefusalReason: findChordTrackRefusal,
    isNoop: (alpha) => {
        ensureEventId(alpha);
        return isChordTrackMutationNoop(alpha);
    },
    validateSessionEntry: isChordTrackSessionEntry,
    undoable: true,
});
