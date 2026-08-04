import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mockValue;
        },
        set: vi.fn((state: ChordTrackState) => {
            mockValue = state;
        }),
    },
    defaultChordTrackState: { enabled: false, events: [] },
}));

vi.mock('../../../useCases/chordTrack/moveChordEvent', () => ({
    moveChordEvent: vi.fn(),
}));

vi.mock('../../../useCases/chordTrack/updateChordEvent', () => ({
    updateChordEvent: vi.fn(),
}));

import { chordTrackStore } from '../../../stores/chordTrackStore';
import { moveChordEvent } from '../../../useCases/chordTrack/moveChordEvent';
import { updateChordEvent } from '../../../useCases/chordTrack/updateChordEvent';
import {
    handleMoveChordEvent,
    handleUpdateChordEvent,
    handleRestoreChordTrackState,
    describeChordTrackMutation,
    isChordTrackMutationNoop,
} from '../handleRestoreChordTrackState';

import type { ChordTrackState } from '../../../stores/chordTrackStore';

const mockedSet = vi.mocked(chordTrackStore.set);
const mockedMove = vi.mocked(moveChordEvent);
const mockedUpdate = vi.mocked(updateChordEvent);

let mockValue: ChordTrackState | null = null;

function setState(state: ChordTrackState | null): void {
    mockValue = state;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = { enabled: false, events: [] };
});

describe('handleRestoreChordTrackState — execute', () => {
    it('writes replacement when current state matches expected', () => {
        const expected: ChordTrackState = { enabled: false, events: [] };
        const replacement: ChordTrackState = {
            enabled: true,
            events: [{ id: 'c1', beat: 0, root: 0, quality: 'major', duration: 4 }],
        };
        setState(expected);

        const result = handleRestoreChordTrackState.execute({
            type: 'restoreChordTrackState',
            payload: { expected, replacement },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mockedSet).toHaveBeenCalledTimes(1);
        // Verify it set the replacement (cloned — not the same reference)
        const setArg = mockedSet.mock.calls[0]?.[0] as ChordTrackState;
        expect(setArg.enabled).toBe(true);
        expect(setArg.events).toHaveLength(1);
        expect(setArg.events[0]?.id).toBe('c1');
    });

    it('returns conflict when current state does not match expected', () => {
        setState({ enabled: true, events: [] });
        const expected: ChordTrackState = { enabled: false, events: [] };
        const replacement: ChordTrackState = { enabled: false, events: [] };

        const result = handleRestoreChordTrackState.execute({
            type: 'restoreChordTrackState',
            payload: { expected, replacement },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedSet).not.toHaveBeenCalled();
    });

    it('returns conflict when store is null', () => {
        setState(null);
        const result = handleRestoreChordTrackState.execute({
            type: 'restoreChordTrackState',
            payload: { expected: { enabled: false, events: [] }, replacement: { enabled: false, events: [] } },
        });
        expect(result).toEqual({ status: 'conflict' });
    });
});

describe('handleRestoreChordTrackState — describe', () => {
    it('returns inverse action with swapped expected/replacement', () => {
        const expected = { enabled: false, events: [] };
        const replacement = {
            enabled: true,
            events: [{ id: 'x', beat: 0, root: 0, quality: 'major' as const, duration: 4 }],
        };
        const result = handleRestoreChordTrackState.describe({
            type: 'restoreChordTrackState',
            payload: { expected, replacement },
        });

        expect(result.label).toBe('Restore chord track state');
        expect(result.inverseAction?.type).toBe('restoreChordTrackState');
        const inversePayload = (result.inverseAction as { payload: { expected: unknown; replacement: unknown } })
            .payload;
        // Inverse swaps expected and replacement
        expect(inversePayload.expected).toEqual(replacement);
        expect(inversePayload.replacement).toEqual(expected);
    });
});

describe('describeChordTrackMutation — addChordEvent', () => {
    it('returns inverse restoreChordTrackState with current state as replacement', () => {
        setState({ enabled: true, events: [{ id: 'e1', beat: 0, root: 5, quality: 'minor', duration: 2 }] });
        const result = describeChordTrackMutation(
            { type: 'addChordEvent', payload: { eventId: 'e2', beat: 4, root: 0, quality: 'major', duration: 4 } },
            'Add chord'
        );

        expect(result.label).toBe('Add chord');
        expect(result.inverseAction?.type).toBe('restoreChordTrackState');
        // The replacement should be the pre-mutation state (1 event)
        const payload = (
            result.inverseAction as unknown as { payload: { expected: ChordTrackState; replacement: ChordTrackState } }
        ).payload;
        expect(payload.replacement.events).toHaveLength(1);
        expect(payload.replacement.events[0]?.id).toBe('e1');
        // The expected should be the post-mutation projected state (2 events)
        expect(payload.expected.events).toHaveLength(2);
    });

    it('returns null inverse when store is null', () => {
        setState(null);
        const result = describeChordTrackMutation(
            { type: 'addChordEvent', payload: { eventId: 'e2', beat: 4, root: 0, quality: 'major', duration: 4 } },
            'Add'
        );
        expect(result.inverseAction).toBeNull();
    });
});

describe('describeChordTrackMutation — clearChordTrack projects empty events', () => {
    it('clearChordTrack sets events to [] in projected state', () => {
        setState({ enabled: true, events: [{ id: 'e1', beat: 0, root: 0, quality: 'major', duration: 4 }] });
        const result = describeChordTrackMutation({ type: 'clearChordTrack', payload: {} } as never, 'Clear');
        const payload = (result.inverseAction as unknown as { payload: { expected: ChordTrackState } }).payload;
        expect(payload.expected.events).toEqual([]);
        // Replacement keeps the original events
    });
});

describe('isChordTrackMutationNoop', () => {
    it('returns true when store is null', () => {
        setState(null);
        expect(isChordTrackMutationNoop({ type: 'clearChordTrack', payload: {} } as never)).toBe(true);
    });

    it('returns false when action would change state', () => {
        setState({ enabled: false, events: [] });
        expect(
            isChordTrackMutationNoop({
                type: 'addChordEvent',
                payload: { eventId: 'x', beat: 0, root: 0, quality: 'major', duration: 4 },
            })
        ).toBe(false);
    });

    it('returns true when toggleChordTrack toggles to the same value', () => {
        setState({ enabled: true, events: [] });
        expect(isChordTrackMutationNoop({ type: 'toggleChordTrack', payload: { enabled: true } })).toBe(true);
    });

    it('returns false when toggleChordTrack flips the value', () => {
        setState({ enabled: true, events: [] });
        expect(isChordTrackMutationNoop({ type: 'toggleChordTrack', payload: { enabled: false } })).toBe(false);
    });
});

describe('projectState — addChordEvent validation', () => {
    it('clamps root to 0-11', () => {
        setState({ enabled: false, events: [] });
        const result = describeChordTrackMutation(
            { type: 'addChordEvent', payload: { eventId: 'e1', beat: 0, root: 15, quality: 'major', duration: 4 } },
            'Add'
        );
        const projected = (result.inverseAction as unknown as { payload: { expected: ChordTrackState } }).payload
            .expected;
        expect(projected.events[0]?.root).toBeLessThanOrEqual(11);
    });

    it('defaults quality to major when invalid', () => {
        setState({ enabled: false, events: [] });
        const result = describeChordTrackMutation(
            { type: 'addChordEvent', payload: { eventId: 'e1', beat: 0, root: 0, quality: 'invalid', duration: 4 } },
            'Add'
        );
        const projected = (result.inverseAction as unknown as { payload: { expected: ChordTrackState } }).payload
            .expected;
        expect(projected.events[0]?.quality).toBe('major');
    });

    it('sorts events by beat after adding', () => {
        setState({ enabled: false, events: [{ id: 'a', beat: 8, root: 0, quality: 'major', duration: 4 }] });
        const result = describeChordTrackMutation(
            { type: 'addChordEvent', payload: { eventId: 'b', beat: 2, root: 0, quality: 'major', duration: 4 } },
            'Add'
        );
        const projected = (result.inverseAction as unknown as { payload: { expected: ChordTrackState } }).payload
            .expected;
        expect(projected.events[0]?.id).toBe('b');
        expect(projected.events[1]?.id).toBe('a');
    });
});

describe('handleMoveChordEvent — execute delegates to moveChordEvent', () => {
    it('calls moveChordEvent with eventId and beat', () => {
        handleMoveChordEvent.execute({ type: 'moveChordEvent', payload: { eventId: 'c1', beat: 8 } });
        expect(mockedMove).toHaveBeenCalledWith('c1', 8);
    });
});

describe('handleUpdateChordEvent — execute delegates to updateChordEvent', () => {
    it('calls updateChordEvent with eventId and payload', () => {
        handleUpdateChordEvent.execute({
            type: 'updateChordEvent',
            payload: { eventId: 'c1', root: 5, quality: 'minor' },
        });
        expect(mockedUpdate).toHaveBeenCalledWith('c1', { eventId: 'c1', root: 5, quality: 'minor' });
    });
});
