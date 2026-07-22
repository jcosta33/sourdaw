import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ChordTrackActionSnapshot, type HandlerDescribeResult } from '#/utils/handlerContract';

import { CHORD_TYPES, type ChordType } from '../../models/ChordTypes';
import { chordTrackStore, type ChordTrackState } from '../../stores/chordTrackStore';
import { moveChordEvent } from '../../useCases/chordTrack/moveChordEvent';
import { updateChordEvent } from '../../useCases/chordTrack/updateChordEvent';

type ChordMutationAction = Exclude<
    Extract<AppAction, { type: `${string}Chord${string}` }>,
    { type: 'generateChordProgression' | 'restoreChordTrackState' }
>;

function cloneState(state: ChordTrackActionSnapshot): ChordTrackState {
    return { enabled: state.enabled, events: state.events.map((event) => ({ ...event })) };
}

function isChordType(quality: string): quality is ChordType {
    return Object.hasOwn(CHORD_TYPES, quality);
}

function projectState(state: ChordTrackState, action: ChordMutationAction): ChordTrackState {
    const projected = cloneState(state);
    if (action.type === 'addChordEvent') {
        const event = {
            id: action.payload.eventId ?? '',
            beat: Math.max(0, action.payload.beat),
            root: Math.max(0, Math.min(11, Math.round(action.payload.root))),
            quality: isChordType(action.payload.quality) ? action.payload.quality : 'major',
            duration: action.payload.duration ?? 4,
        };
        projected.events.push(event);
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
            return {
                ...event,
                ...(action.payload.root === undefined ? {} : { root: ((action.payload.root % 12) + 12) % 12 }),
                ...(action.payload.quality === undefined ? {} : { quality: action.payload.quality }),
                ...(action.payload.duration === undefined ? {} : { duration: Math.max(0.25, action.payload.duration) }),
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

export function describeChordTrackMutation(action: ChordMutationAction, label: string): HandlerDescribeResult {
    const state = chordTrackStore.value;
    if (!state) {
        return { label, inverseAction: null };
    }
    const expected = projectState(state, action);
    const replacement = cloneState(state);
    return { label, inverseAction: { type: 'restoreChordTrackState', payload: { expected, replacement } } };
}

export function isChordTrackMutationNoop(action: ChordMutationAction): boolean {
    const state = chordTrackStore.value;
    return !state || JSON.stringify(state) === JSON.stringify(projectState(state, action));
}

export const handleMoveChordEvent = createHandler<'moveChordEvent'>({
    execute: (action) => moveChordEvent(action.payload.eventId, action.payload.beat),
    describe: (action) => describeChordTrackMutation(action, 'Move chord event'),
    isNoop: isChordTrackMutationNoop,
    undoable: true,
});

export const handleUpdateChordEvent = createHandler<'updateChordEvent'>({
    execute: (action) => updateChordEvent(action.payload.eventId, action.payload),
    describe: (action) => describeChordTrackMutation(action, 'Update chord event'),
    isNoop: isChordTrackMutationNoop,
    undoable: true,
});

export const handleRestoreChordTrackState = createHandler<'restoreChordTrackState'>({
    execute: (action) => {
        const current = chordTrackStore.value;
        const matchesExpected = current && JSON.stringify(current) === JSON.stringify(action.payload.expected);
        if (!matchesExpected) {
            return { status: 'conflict' };
        }
        chordTrackStore.set(cloneState(action.payload.replacement));
        return { status: 'written' };
    },
    describe: (action) => ({
        label: 'Restore chord track state',
        inverseAction: {
            type: 'restoreChordTrackState',
            payload: { expected: action.payload.replacement, replacement: action.payload.expected },
        },
    }),
    undoable: true,
});
