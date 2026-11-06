import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { removeCompRegion } from '../removeCompRegion';

const mocks = vi.hoisted(() => ({
    state: { value: null as TakeLaneStoreState | null },
    set: vi.fn(),
    execute: vi.fn(),
    pushUndoEntry: vi.fn(),
}));
vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: mocks.execute,
    pushUndoEntry: mocks.pushUndoEntry,
}));

function selectedLane(trackId = 't1') {
    return {
        id: `lane-${trackId}`,
        trackId,
        takes: [
            {
                id: `take-${trackId}`,
                clipId: `clip-${trackId}`,
                name: 'Take',
                startBeat: 0,
                endBeat: 4,
                selected: false,
            },
        ],
        activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: `take-${trackId}` }],
    };
}

describe('removeCompRegion user command wrapper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [selectedLane()] };
        trackStore.set({
            tracks: ['t1', 't2'].map((id) =>
                TrackDummy.create({ id, clips: [ClipDummy.create({ id: `clip-${id}`, trackId: id })] })
            ),
            selectedTrackId: 't1',
            ghostClips: [],
        });
    });

    it('dispatches the matching interval and delegates saved Undo ownership to Command', () => {
        removeCompRegion('t1', 0);
        expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
            type: 'removeCompRegion',
            payload: { trackId: 't1', startBeat: 0 },
        });
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
    it('is a no-op when the take-lane store has not loaded', () => {
        mocks.state.value = null;
        removeCompRegion('t1', 0);
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it('is a no-op when the track has no lane', () => {
        mocks.state.value = { lanes: [selectedLane('t2')] };
        removeCompRegion('t1', 0);
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it('is a no-op when the lane has no region at that exact head', () => {
        removeCompRegion('t1', 2);
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it('does not mutate either lane before Command admits the targeted removal', () => {
        mocks.state.value = { lanes: [selectedLane(), selectedLane('t2')] };
        const before = structuredClone(mocks.state.value);
        removeCompRegion('t1', 0);
        expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
            type: 'removeCompRegion',
            payload: { trackId: 't1', startBeat: 0 },
        });
        expect(mocks.state.value).toEqual(before);
        expect(mocks.set).not.toHaveBeenCalled();
    });
    it('refuses a region whose take owner is absent', () => {
        mocks.state.value = { lanes: [{ ...selectedLane(), takes: [] }] };
        removeCompRegion('t1', 0);
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it('does not dispatch a removed clip owner', () => {
        trackStore.set({ tracks: [TrackDummy.create({ id: 't1', clips: [] })], selectedTrackId: 't1', ghostClips: [] });
        removeCompRegion('t1', 0);
        expect(mocks.execute).not.toHaveBeenCalled();
    });
});
