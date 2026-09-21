import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { removeCompRegion } from '../removeCompRegion';

type MockRegion = { startBeat: number; endBeat: number; takeId: string };
type MockTake = { id: string; clipId: string; name: string; startBeat: number; endBeat: number; selected: boolean };
type MockLane = { id: string; trackId: string; takes: MockTake[]; activeCompRegions: MockRegion[] };
type TakeLaneState = { lanes: MockLane[] };
type TakeLaneHolder = { value: TakeLaneState | null };

const mocks = vi.hoisted(() => {
    const holder: TakeLaneHolder = { value: { lanes: [] } };
    return {
        takeLaneValue: holder,
        takeLaneSet: vi.fn<(state: TakeLaneState) => void>(),
        pushUndoEntry: vi.fn<(label: string, undo: () => void, redo: () => void) => void>(),
    };
});

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneValue.value;
        },
        set: mocks.takeLaneSet,
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

describe('removeCompRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // A replayed facet goes back through the lane liveness rule, so the fixtures
        // need the tracks and clips their take ids stand for.
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'clip-a', trackId: 't1' })] }),
                TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'clip-other', trackId: 't2' })] }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        });
    });

    it('removes the matching region from the lane and records an undo entry', () => {
        mocks.takeLaneValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [],
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 4, takeId: 'take-a' },
                        { startBeat: 4, endBeat: 8, takeId: 'take-b' },
                    ],
                },
            ],
        };

        removeCompRegion('t1', 4);

        expect(mocks.takeLaneSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.takeLaneSet.mock.calls[0]!;
        expect(setCall[0].lanes[0]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: 'take-a' }]);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the take-lane store has not loaded', () => {
        mocks.takeLaneValue.value = null;

        removeCompRegion('t1', 0);

        expect(mocks.takeLaneSet).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('is a no-op when the track has no lane', () => {
        mocks.takeLaneValue.value = { lanes: [{ id: 'lane-1', trackId: 'other', takes: [], activeCompRegions: [] }] };

        removeCompRegion('t1', 0);

        expect(mocks.takeLaneSet).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('is a no-op when the lane has no region at the given start beat', () => {
        mocks.takeLaneValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'a' }],
                },
            ],
        };

        removeCompRegion('t1', 99);

        expect(mocks.takeLaneSet).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('leaves unrelated lanes untouched when removing a region from one track', () => {
        mocks.takeLaneValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-a' }],
                },
                {
                    id: 'lane-2',
                    trackId: 't2',
                    takes: [],
                    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'other-take' }],
                },
            ],
        };

        removeCompRegion('t1', 0);

        const setCall = mocks.takeLaneSet.mock.calls[0]!;
        // The unrelated t2 lane passes through the map short-circuit unchanged.
        expect(setCall[0].lanes[1]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 8, takeId: 'other-take' }]);
        expect(setCall[0].lanes[0]!.activeCompRegions).toEqual([]);
    });

    it('records undo/redo entries that restore the previous and next state', () => {
        mocks.takeLaneValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        {
                            id: 'take-a',
                            clipId: 'clip-a',
                            name: 'Take A',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-a' }],
                },
            ],
        };

        removeCompRegion('t1', 0);

        const undoCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoCall) {
            throw new Error('expected pushUndoEntry to be called');
        }
        const [, undo, redo] = undoCall;
        // Undo restores the pre-remove region; redo re-applies the empty state.
        undo();
        const undoArg = mocks.takeLaneSet.mock.calls.at(-1)![0];
        expect(undoArg.lanes[0]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: 'take-a' }]);

        redo();
        const redoArg = mocks.takeLaneSet.mock.calls.at(-1)![0];
        expect(redoArg.lanes[0]!.activeCompRegions).toEqual([]);
    });
});
