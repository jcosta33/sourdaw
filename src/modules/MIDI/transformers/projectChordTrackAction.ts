import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';
import { type ChordTrackState } from '../stores/chordTrackStore';

import { cloneChordTrackState } from './cloneChordTrackState';
import { type ChordMutationAction } from './isChordTrackEditAction';

function isChordType(quality: string): quality is ChordType {
    return Object.hasOwn(CHORD_TYPES, quality);
}

/** The state one chord-track action leaves behind, by the same normalisation its use case applies. */
export function projectChordTrackAction(state: ChordTrackState, action: ChordMutationAction): ChordTrackState {
    const projected = cloneChordTrackState(state);
    if (action.type === 'addChordEvent') {
        projected.events.push({
            id: action.payload.eventId ?? '',
            beat: Math.max(0, action.payload.beat),
            root: Math.max(0, Math.min(11, Math.round(action.payload.root))),
            quality: isChordType(action.payload.quality) ? action.payload.quality : 'major',
            duration: action.payload.duration ?? 4,
        });
        projected.events.sort((alpha, beta) => alpha.beat - beta.beat);
    } else if (action.type === 'moveChordEvent') {
        const event = projected.events.find((candidate) => candidate.id === action.payload.eventId);
        if (event) {
            event.beat = Math.max(0, action.payload.beat);
        }
        projected.events.sort((alpha, beta) => alpha.beat - beta.beat);
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
                duration: duration === undefined ? event.duration : Math.max(0.25, duration),
            };
        });
    } else if (action.type === 'removeChordEvent') {
        projected.events = projected.events.filter((event) => event.id !== action.payload.eventId);
    } else if (action.type === 'toggleChordTrack') {
        projected.enabled = action.payload?.enabled ?? !projected.enabled;
    } else {
        projected.events = [];
    }
    return projected;
}
