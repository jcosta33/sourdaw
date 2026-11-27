import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../stores/chordTrackStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/chordTrackStore')>()),
    chordTrackStore: {
        get value() {
            return mockValue;
        },
        set: vi.fn((state: ChordTrackState) => {
            mockValue = state;
        }),
    },
}));

import { type AppAction } from '#/utils/handlerContract';

import { type ChordTrackState } from '../../../stores/chordTrackStore';
import { handleAddChordEvent } from '../handleAddChordEvent';
import { handleClearChordTrack } from '../handleClearChordTrack';
import { handleRemoveChordEvent } from '../handleRemoveChordEvent';
import { handleRestoreChordTrackState } from '../handleRestoreChordTrackState';
import { handleToggleChordTrack } from '../handleToggleChordTrack';

let mockValue: ChordTrackState | null = null;

const THREE_CHORDS: ChordTrackState = {
    enabled: true,
    events: [
        { id: 'c-1', beat: 0, root: 0, quality: 'major', duration: 4 },
        { id: 'c-2', beat: 4, root: 7, quality: '7', duration: 2.5 },
        { id: 'c-3', beat: 8, root: 9, quality: 'min7', duration: 4 },
    ],
};

type RestoreAction = Extract<AppAction, { type: 'restoreChordTrackState' }>;

function requireRestore(action: AppAction | null | undefined): RestoreAction {
    if (action?.type !== 'restoreChordTrackState') {
        throw new Error('Expected a restoreChordTrackState inverse');
    }
    return action;
}

beforeEach(() => {
    mockValue = structuredClone(THREE_CHORDS);
});

describe('clearChordTrack as an agent command', () => {
    it('restores every removed event exactly through its inverse, and redoes through the forward action', () => {
        const action: AppAction = { type: 'clearChordTrack' };
        const inverse = requireRestore(handleClearChordTrack.describe({ type: 'clearChordTrack' }).inverseAction);

        void handleClearChordTrack.execute(action);
        expect(mockValue).toEqual({ enabled: true, events: [] });

        expect(handleRestoreChordTrackState.execute(inverse)).toEqual({ status: 'written' });
        expect(mockValue).toEqual(THREE_CHORDS);

        void handleClearChordTrack.execute(action);
        expect(mockValue).toEqual({ enabled: true, events: [] });
    });

    it('is a no-op on an empty chord track', () => {
        mockValue = { enabled: true, events: [] };
        expect(handleClearChordTrack.isNoop?.({ type: 'clearChordTrack' })).toBe(true);
    });

    it('describes against the track the earlier actions of its batch leave, not the live track', () => {
        const added: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 12, root: 5, quality: 'minor', duration: 2, eventId: 'c-4' },
        };
        const clear: AppAction = { type: 'clearChordTrack' };
        const inverse = requireRestore(
            handleClearChordTrack.describe({ type: 'clearChordTrack' }, { actions: [added, clear], actionIndex: 1 })
                .inverseAction
        );

        expect(inverse.payload.expected).toEqual({ enabled: true, events: [] });
        expect(inverse.payload.replacement.events.map((event) => event.id)).toEqual(['c-1', 'c-2', 'c-3', 'c-4']);
    });

    it('refuses a project without a chord track', () => {
        mockValue = null;
        expect(handleClearChordTrack.validate?.({ type: 'clearChordTrack' }, { actions: [], actionIndex: 0 })).toBe(
            false
        );
        expect(
            handleClearChordTrack.validationRefusalReason?.(
                { type: 'clearChordTrack' },
                { actions: [], actionIndex: 0 }
            )
        ).toBe('The project has no chord track');
    });
});

describe('addChordEvent as an agent command', () => {
    it('keeps the application-minted event id it was given, in describe, no-op detection and execute', () => {
        const action: Extract<AppAction, { type: 'addChordEvent' }> = {
            type: 'addChordEvent',
            payload: { beat: 12, root: 5, quality: 'minor', eventId: 'chord-command-fixed' },
        };

        const inverse = requireRestore(handleAddChordEvent.describe(action).inverseAction);
        expect(handleAddChordEvent.isNoop?.(action)).toBe(false);
        void handleAddChordEvent.execute(action);

        expect(mockValue?.events.map((event) => event.id)).toContain('chord-command-fixed');
        expect(inverse.payload.expected).toEqual(mockValue);
        expect(inverse.payload.replacement).toEqual(THREE_CHORDS);
        expect(action.payload.eventId).toBe('chord-command-fixed');
    });

    it('refuses an event id that the track or an earlier action of the batch already holds', () => {
        const duplicateOfTrack: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 1, root: 0, quality: 'major', eventId: 'c-2' },
        };
        const first: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 1, root: 0, quality: 'major', eventId: 'c-9' },
        };
        const second: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 2, root: 0, quality: 'major', eventId: 'c-9' },
        };

        expect(handleAddChordEvent.validate?.(duplicateOfTrack, { actions: [duplicateOfTrack], actionIndex: 0 })).toBe(
            false
        );
        expect(handleAddChordEvent.validate?.(first, { actions: [first, second], actionIndex: 0 })).toBe(true);
        expect(handleAddChordEvent.validate?.(second, { actions: [first, second], actionIndex: 1 })).toBe(false);
    });
});

describe('toggleChordTrack as an agent command', () => {
    it('is a no-op when the chord track is already in the requested state and restores the prior state otherwise', () => {
        expect(handleToggleChordTrack.isNoop?.({ type: 'toggleChordTrack', payload: { enabled: true } })).toBe(true);

        const action: AppAction = { type: 'toggleChordTrack', payload: { enabled: false } };
        const inverse = requireRestore(handleToggleChordTrack.describe(action).inverseAction);
        void handleToggleChordTrack.execute(action);
        expect(mockValue?.enabled).toBe(false);

        expect(handleRestoreChordTrackState.execute(inverse)).toEqual({ status: 'written' });
        expect(mockValue).toEqual(THREE_CHORDS);
    });
});

describe('chord track session entries', () => {
    function describedEntry(): Parameters<NonNullable<typeof handleClearChordTrack.validateSessionEntry>>[0] {
        const action: AppAction = { type: 'clearChordTrack' };
        const described = handleClearChordTrack.describe(action);
        if (!described.inverseAction || !described.redoAction) {
            throw new Error('Expected an inverse and a redo');
        }
        return { action, inverseAction: described.inverseAction, redoAction: described.redoAction };
    }

    it('describes redo as the inverse pair swapped and admits that entry', () => {
        const entry = describedEntry();
        const inverse = requireRestore(entry.inverseAction);
        const redo = requireRestore(entry.redoAction);

        expect(redo.payload.expected).toEqual(inverse.payload.replacement);
        expect(redo.payload.replacement).toEqual(inverse.payload.expected);
        expect(handleClearChordTrack.validateSessionEntry?.(entry)).toBe(true);
    });

    it('refuses an entry without a redo and one whose redo is not guarded by the track it replaces', () => {
        const entry = describedEntry();
        const redo = requireRestore(entry.redoAction);

        expect(handleClearChordTrack.validateSessionEntry?.({ ...entry, redoAction: undefined })).toBe(false);
        expect(
            handleClearChordTrack.validateSessionEntry?.({
                ...entry,
                redoAction: {
                    type: 'restoreChordTrackState',
                    payload: { expected: { enabled: false, events: [] }, replacement: redo.payload.replacement },
                },
            })
        ).toBe(false);
    });

    it('refuses an entry whose expected track does not follow from its replacement under the stored action', () => {
        const entry = describedEntry();
        const inverse = requireRestore(entry.inverseAction);
        const tamperedExpected = { enabled: true, events: [THREE_CHORDS.events[0]!] };
        const tampered = {
            ...entry,
            inverseAction: {
                type: 'restoreChordTrackState' as const,
                payload: { expected: tamperedExpected, replacement: inverse.payload.replacement },
            },
            redoAction: {
                type: 'restoreChordTrackState' as const,
                payload: { expected: inverse.payload.replacement, replacement: tamperedExpected },
            },
        };

        expect(handleClearChordTrack.validateSessionEntry?.(tampered)).toBe(false);
    });
});

describe('chord track session entry refusals', () => {
    const emptyTrack: ChordTrackState = { enabled: true, events: [] };

    function pair(overrides: {
        expected?: unknown;
        replacement?: unknown;
    }): Pick<
        Parameters<NonNullable<typeof handleClearChordTrack.validateSessionEntry>>[0],
        'inverseAction' | 'redoAction'
    > {
        const expected = overrides.expected ?? THREE_CHORDS;
        const replacement = overrides.replacement ?? emptyTrack;
        const inverse = { type: 'restoreChordTrackState', payload: { expected: replacement, replacement: expected } };
        const redo = { type: 'restoreChordTrackState', payload: { expected, replacement } };
        return { inverseAction: inverse as AppAction, redoAction: redo as AppAction };
    }

    it('admits a clear entry whose pair is well formed, as the control for the refusals below', () => {
        expect(handleClearChordTrack.validateSessionEntry?.({ action: { type: 'clearChordTrack' }, ...pair({}) })).toBe(
            true
        );
    });

    it('refuses an entry whose stored action is not a chord-track edit', () => {
        expect(handleClearChordTrack.validateSessionEntry?.({ action: { type: 'togglePlayback' }, ...pair({}) })).toBe(
            false
        );
    });

    it('refuses an entry whose restore payload is not a well-formed chord-track snapshot pair', () => {
        const malformed = { enabled: 'yes', events: [] };
        expect(
            handleClearChordTrack.validateSessionEntry?.({
                action: { type: 'clearChordTrack' },
                ...pair({ replacement: malformed }),
            })
        ).toBe(false);
    });

    it('refuses a replacement holding an event with an empty id, which the store would refuse to hold', () => {
        const emptyId: ChordTrackState = {
            enabled: true,
            events: [{ id: '', beat: 0, root: 0, quality: 'major', duration: 4 }],
        };
        expect(
            handleClearChordTrack.validateSessionEntry?.({
                action: { type: 'clearChordTrack' },
                ...pair({ expected: emptyId, replacement: emptyTrack }),
            })
        ).toBe(false);
    });

    it('refuses a replacement holding two events that share an id', () => {
        const sharedId: ChordTrackState = {
            enabled: true,
            events: [
                { id: 'c-1', beat: 0, root: 0, quality: 'major', duration: 4 },
                { id: 'c-1', beat: 4, root: 7, quality: '7', duration: 2.5 },
            ],
        };
        expect(
            handleClearChordTrack.validateSessionEntry?.({
                action: { type: 'clearChordTrack' },
                ...pair({ expected: sharedId, replacement: emptyTrack }),
            })
        ).toBe(false);
    });

    it('refuses an addChordEvent entry that never pinned its event id', () => {
        const withEvent: ChordTrackState = {
            enabled: true,
            events: [{ id: 'c-9', beat: 1, root: 0, quality: 'major', duration: 4 }],
        };
        const pinned: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 1, root: 0, quality: 'major', duration: 4, eventId: 'c-9' },
        };
        const unpinned: AppAction = {
            type: 'addChordEvent',
            payload: { beat: 1, root: 0, quality: 'major', duration: 4 },
        };
        // before = empty track, after = track holding the added event
        const entryPair = pair({ expected: emptyTrack, replacement: withEvent });

        expect(handleAddChordEvent.validateSessionEntry?.({ action: pinned, ...entryPair })).toBe(true);
        expect(handleAddChordEvent.validateSessionEntry?.({ action: unpinned, ...entryPair })).toBe(false);
    });
});

describe('removeChordEvent admission', () => {
    it('admits a removal while a chord track exists and refuses it with the reason when none does', () => {
        const action: AppAction = { type: 'removeChordEvent', payload: { eventId: 'c-2' } };
        const context = { actions: [action], actionIndex: 0 };

        expect(handleRemoveChordEvent.validate?.(action, context)).toBe(true);

        mockValue = null;
        expect(handleRemoveChordEvent.validate?.(action, context)).toBe(false);
        expect(handleRemoveChordEvent.validationRefusalReason?.(action, context)).toBe(
            'The project has no chord track'
        );
    });
});

describe('chord track restores', () => {
    it('refuses to overwrite a chord edit made after the command it undoes', () => {
        const inverse = requireRestore(
            handleRemoveChordEvent.describe({ type: 'removeChordEvent', payload: { eventId: 'c-2' } }).inverseAction
        );
        void handleRemoveChordEvent.execute({ type: 'removeChordEvent', payload: { eventId: 'c-2' } });
        void handleToggleChordTrack.execute({ type: 'toggleChordTrack', payload: { enabled: false } });

        expect(handleRestoreChordTrackState.validate?.(inverse, { actions: [inverse], actionIndex: 0 })).toBe(false);
        expect(handleRestoreChordTrackState.execute(inverse)).toEqual({ status: 'conflict' });
        expect(mockValue?.enabled).toBe(false);
        expect(mockValue?.events.map((event) => event.id)).toEqual(['c-1', 'c-3']);
    });

    it('admits only a well-formed snapshot pair into the session replay', () => {
        const valid = { expected: THREE_CHORDS, replacement: { enabled: false, events: [] } };
        expect(handleRestoreChordTrackState.validateSessionActionArguments?.(valid)).toBe(true);
        const shortestChord = {
            expected: THREE_CHORDS,
            replacement: { enabled: true, events: [{ id: 'x', beat: 0, root: 0, quality: 'major', duration: 0.25 }] },
        };
        expect(handleRestoreChordTrackState.validateSessionActionArguments?.(shortestChord)).toBe(true);
        for (const invalid of [
            { expected: THREE_CHORDS },
            { expected: THREE_CHORDS, replacement: { enabled: 'yes', events: [] } },
            {
                expected: THREE_CHORDS,
                replacement: { enabled: true, events: [{ id: 'x', beat: -1, root: 0, quality: 'major', duration: 4 }] },
            },
            {
                expected: THREE_CHORDS,
                replacement: { enabled: true, events: [{ id: 'x', beat: 0, root: 12, quality: 'major', duration: 4 }] },
            },
            {
                expected: THREE_CHORDS,
                replacement: {
                    enabled: true,
                    events: [{ id: 'x', beat: 0, root: 0, quality: 'toString', duration: 4 }],
                },
            },
            {
                expected: THREE_CHORDS,
                replacement: {
                    enabled: true,
                    events: [{ id: 'x', beat: 0, root: 0, quality: 'major', duration: 0.1 }],
                },
            },
        ]) {
            expect(handleRestoreChordTrackState.validateSessionActionArguments?.(invalid)).toBe(false);
        }
    });
});
