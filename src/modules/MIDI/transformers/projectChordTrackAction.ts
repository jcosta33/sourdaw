import { compareChordEvents, MIN_CHORD_DURATION_BEATS } from '../models/ChordEvent';
import { type ChordTrackState } from '../models/ChordTrackState';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

import { cloneChordTrackState } from './cloneChordTrackState';
import { findChordEventArgumentRefusal } from './findChordEventArgumentRefusal';
import { type ChordMutationAction } from './isChordTrackEditAction';

function isChordType(quality: string): quality is ChordType {
    return Object.hasOwn(CHORD_TYPES, quality);
}

/** The state one chord-track action leaves behind, by the same normalisation its use case applies. */
export function projectChordTrackAction(state: ChordTrackState, action: ChordMutationAction): ChordTrackState {
    const projected = cloneChordTrackState(state);
    if (action.type === 'addChordEvent') {
        const { beat, root, quality, duration, eventId } = action.payload;
        // A refused add writes nothing, so it projects to the track it was refused against.
        if (findChordEventArgumentRefusal(action.payload) === null && isChordType(quality)) {
            projected.events.push({ id: eventId ?? '', beat, root, quality, duration: duration ?? 4 });
            projected.events.sort(compareChordEvents);
        }
    } else if (action.type === 'moveChordEvent') {
        const event = projected.events.find((candidate) => candidate.id === action.payload.eventId);
        if (event) {
            event.beat = Math.max(0, action.payload.beat);
        }
        projected.events.sort(compareChordEvents);
    } else if (action.type === 'updateChordEvent') {
        projected.events = projected.events.map((event) => {
            if (event.id !== action.payload.eventId) {
                return event;
            }
            const { root, quality, duration } = action.payload;
            return {
                id: event.id,
                beat: event.beat,
                root: root === undefined ? event.root : ((root % 12) + 12) % 12,
                quality: quality ?? event.quality,
                duration: duration === undefined ? event.duration : Math.max(MIN_CHORD_DURATION_BEATS, duration),
            };
        });
    } else if (action.type === 'removeChordEvent') {
        projected.events = projected.events.filter((event) => event.id !== action.payload.eventId);
    } else if (action.type === 'toggleChordTrack') {
        projected.enabled = action.payload.enabled;
    } else {
        projected.events = [];
    }
    return projected;
}
