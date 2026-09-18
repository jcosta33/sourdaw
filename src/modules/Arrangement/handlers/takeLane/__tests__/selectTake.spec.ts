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

    it('refuses a prefix containing a selectTake captured for a replaced lane owner', () => {
        const lane = { ...createTakeLaneFixture('track-1'), takes: [createTake('a', true), createTake('b', false)] };
        seedLanes([lane]);
        const context = {
            actions: [
                {
                    type: 'selectTake' as const,
                    payload: {
                        trackId: 'track-1',
                        takeId: 'b',
                        expectedLaneId: 'replaced-lane',
                        expectedSelectedTakeId: 'a',
                    },
                },
            ],
            actionIndex: 1,
        };

        const isValid = handleSelectTake.validate!(
            {
                type: 'selectTake',
                payload: {
                    trackId: 'track-1',
                    takeId: 'b',
                    expectedLaneId: lane.id,
                    expectedSelectedTakeId: 'a',
                },
            },
            context
        );

        expect(isValid).toBe(false);
    });

    it('refuses a replaced lane owner before execute or noop classification', () => {
        const lane = { ...createTakeLaneFixture('track-1'), takes: [createTake('a', false), createTake('b', true)] };
        seedLanes([lane]);
        const action = {
            type: 'selectTake' as const,
            payload: {
                trackId: 'track-1',
                takeId: 'b',
                expectedLaneId: 'lane-before-replacement',
                expectedSelectedTakeId: 'b',
            },
        };

        expect(handleSelectTake.validate!(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(handleSelectTake.isNoop?.(action)).toBe(false);
        expect(handleSelectTake.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.takeLaneStoreValue.value!.lanes[0]).toBe(lane);
        expect(handleSelectTake.describe(action)).toEqual({
            label: 'Select take',
            inverseAction: null,
        });
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
            payload: {
                trackId: 'track-1',
                takeId: 'a',
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: 'b',
            },
        });
        expect(described.redoAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: 'b',
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: 'a',
            },
        });
    });

    it('describes a selection against the preceding sibling selection', () => {
        seedLanes([
            {
                ...createTakeLaneFixture('track-1'),
                takes: [createTake('a', true), createTake('b', false), createTake('c', false)],
            },
        ]);
        const previous = { type: 'selectTake' as const, payload: { trackId: 'track-1', takeId: 'b' } };
        const action = { type: 'selectTake' as const, payload: { trackId: 'track-1', takeId: 'c' } };

        const described = handleSelectTake.describe(action, { actions: [previous, action], actionIndex: 1 });

        expect(described.inverseAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: 'b',
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: 'c',
            },
        });
        expect(described.redoAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: 'c',
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: 'b',
            },
        });
    });

    it('refuses ambiguous same-track lane owners before execute or noop classification', () => {
        const first = { ...createTakeLaneFixture('track-1'), takes: [createTake('a', true)] };
        const second = { ...first, id: 'replacement-lane' };
        seedLanes([first, second]);
        const action = { type: 'selectTake' as const, payload: { trackId: 'track-1', takeId: 'a' } };

        expect(handleSelectTake.validate!(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(handleSelectTake.isNoop?.(action)).toBe(false);
        expect(handleSelectTake.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.takeLaneStoreValue.value?.lanes).toEqual([first, second]);
    });

    it('describes an owner-guarded inverse that restores no prior selection', () => {
        seedLanes([{ ...createTakeLaneFixture('track-1'), takes: [createTake('a', false)] }]);

        const described = handleSelectTake.describe({
            type: 'selectTake',
            payload: { trackId: 'track-1', takeId: 'a' },
        });

        expect(described.inverseAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: null,
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: 'a',
            },
        });
        expect(described.redoAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: 'a',
                expectedLaneId: 'lane-track-1',
                expectedSelectedTakeId: null,
            },
        });
    });

    it('admits a null target only for owner-guarded internal replay', () => {
        const lane = { ...createTakeLaneFixture('track-1'), takes: [createTake('a', true)] };
        seedLanes([lane]);
        const unguarded = { type: 'selectTake' as const, payload: { trackId: 'track-1', takeId: null } };
        const guarded = {
            type: 'selectTake' as const,
            payload: {
                trackId: 'track-1',
                takeId: null,
                expectedLaneId: lane.id,
                expectedSelectedTakeId: 'a',
            },
        };

        expect(handleSelectTake.validate!(unguarded, { actions: [unguarded], actionIndex: 0 })).toBe(false);
        expect(handleSelectTake.execute(unguarded)).toEqual({ status: 'conflict' });
        expect(handleSelectTake.validate!(guarded, { actions: [guarded], actionIndex: 0 })).toBe(true);
        expect(handleSelectTake.execute(guarded)).toEqual({ status: 'written' });
        expect(mocks.takeLaneStoreValue.value!.lanes[0]!.takes[0]!.selected).toBe(false);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleSelectTake.undoable).toBe(true);
        expect(handleSelectTake.canReportConflict).toBe(true);
    });
});
