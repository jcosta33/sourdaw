import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Take, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { handleSelectTake } from '../selectTake';

function createTake(id: string, selected: boolean): Take {
    return { id, clipId: `clip-${id}`, name: id, startBeat: 0, endBeat: 4, selected };
}

function createTakeLaneFixture(trackId: string): TakeLane {
    return { id: `lane-${trackId}`, trackId, takes: [], activeCompRegions: [] };
}

function seedLanes(lanes: readonly TakeLane[]): void {
    mocks.takeLaneStoreValue.value = { lanes: [...lanes] };
}

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn((state: TakeLaneStoreState) => {
            mocks.takeLaneStoreValue.value = state;
        }),
    },
}));

describe('handleSelectTake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('selects the requested take and deselects its lane siblings', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const result = handleSelectTake.execute({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b' },
        });

        expect(result).toEqual({ status: 'written' });
        const updated = mocks.takeLaneStoreValue.value!.lanes[0]!;
        expect(updated.takes.find((take) => take.id === 'a')?.selected).toBe(false);
        expect(updated.takes.find((take) => take.id === 'b')?.selected).toBe(true);
    });

    it('preserves every other lane by reference', () => {
        const target: TakeLane = { ...createTakeLaneFixture('track-1'), takes: [createTake('a', true)] };
        const other: TakeLane = { ...createTakeLaneFixture('track-2'), takes: [createTake('z', true)] };
        seedLanes([target, other]);

        handleSelectTake.execute({ type: 'selectTake', payload: { trackId: 'track-1', takeId: 'a' } });

        const next = mocks.takeLaneStoreValue.value!;
        expect(next.lanes).toHaveLength(2);
        expect(next.lanes[1]).toBe(other);
    });

    it('refuses when the lane is missing', () => {
        seedLanes([{ ...createTakeLaneFixture('track-2'), takes: [createTake('z', true)] }]);

        const result = handleSelectTake.execute({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'a' },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('refuses when the take is missing from the lane', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true)] }]);

        const result = handleSelectTake.execute({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'gone' },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('refuses when the live selection diverged from expectedSelectedTakeId', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const result = handleSelectTake.execute({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b', expectedSelectedTakeId: 'b' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.takeLaneStoreValue.value!.lanes[0]!.takes.find((take) => take.id === 'b')?.selected).toBe(false);
    });

    it('writes when expectedSelectedTakeId still matches the live selection', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const result = handleSelectTake.execute({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b', expectedSelectedTakeId: 'a' },
        });

        expect(result).toEqual({ status: 'written' });
    });

    it('is a noop when the requested take is already selected', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const isNoop = handleSelectTake.isNoop?.({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'a' },
        });

        expect(isNoop).toBe(true);
    });

    it('is not a noop when a different take is selected', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const isNoop = handleSelectTake.isNoop?.({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b' },
        });

        expect(isNoop).toBe(false);
    });

    it('validates against a prior sibling selectTake on the same lane', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);
        const context = {
            actions: [{ type: 'selectTake' as const, payload: { trackId: 'track-1', takeId: 'b' } }],
            actionIndex: 1,
        };

        const isValid = handleSelectTake.validate!(
            { type: 'selectTake', payload: { trackId: 'track-1', takeId: 'a', expectedSelectedTakeId: 'b' } },
            context
        );

        expect(isValid).toBe(true);
    });

    it('describes a self-inverse that restores the previously selected take', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] }]);

        const described = handleSelectTake.describe({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b' },
        });

        expect(described.label).toBe('Select take');
        expect(described.inverseAction).toEqual({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'a', expectedSelectedTakeId: 'b' },
        });
        expect(described.redoAction).toEqual({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'b', expectedSelectedTakeId: 'a' },
        });
    });

    it('describes no inverse when no take was previously selected', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', false)] }]);

        const described = handleSelectTake.describe({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'a' },
        });

        expect(described.inverseAction).toBeNull();
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleSelectTake.undoable).toBe(true);
        expect(handleSelectTake.canReportConflict).toBe(true);
    });
});
