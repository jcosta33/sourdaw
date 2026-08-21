import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveAllTracks } from '../handleRemoveAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeTrack: vi.fn(),
    captureTrackRemovalSnapshot: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));

vi.mock('../../../useCases/captureTrackRemovalSnapshot', () => ({
    captureTrackRemovalSnapshot: mocks.captureTrackRemovalSnapshot,
}));

function createSnapshot(trackId: string, trackIndex: number) {
    return {
        trackId,
        trackSnapshot: { id: trackId },
        trackName: trackId,
        trackKind: 'audio' as const,
        trackGain: 1,
        trackParentId: null,
        trackIndex,
        wasSelected: false,
        routingPatches: [],
        automationLaneSnapshots: [],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        takeLaneSnapshots: [],
        sidechainRouteSnapshots: [],
        ownedModulatorSnapshots: [],
        incomingModulationMappingSnapshots: [],
    };
}

describe('handleRemoveAllTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('bails if track store state is unavailable', () => {
            mocks.getTrackStoreState.mockReturnValue(null);

            void handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });

            expect(mocks.removeTrack).not.toHaveBeenCalled();
        });

        it('removes all tracks in the store', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1' }, { id: 't2' }],
            });

            void handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });

            expect(mocks.removeTrack).toHaveBeenCalledTimes(2);
            expect(mocks.removeTrack).toHaveBeenCalledWith('t1');
            expect(mocks.removeTrack).toHaveBeenCalledWith('t2');
        });
    });

    describe('describe', () => {
        it('emits no inverse action for an empty project', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleRemoveAllTracks.describe({ type: 'removeAllTracks', payload: undefined });

            expect(desc.label).toBe('Remove all tracks');
            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackRemovalSnapshot).not.toHaveBeenCalled();
        });

        it('captures every live track in track order, carrying original indices', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
            });
            const snapshotT1 = createSnapshot('t1', 0);
            const snapshotT2 = createSnapshot('t2', 1);
            const snapshotT3 = createSnapshot('t3', 2);
            const byId: Record<string, ReturnType<typeof createSnapshot>> = {
                t1: snapshotT1,
                t2: snapshotT2,
                t3: snapshotT3,
            };
            mocks.captureTrackRemovalSnapshot.mockImplementation((trackId: string) => byId[trackId]);

            const action = { type: 'removeAllTracks' as const, payload: undefined };
            const desc = handleRemoveAllTracks.describe(action);

            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenCalledTimes(3);
            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenNthCalledWith(1, 't1');
            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenNthCalledWith(2, 't2');
            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenNthCalledWith(3, 't3');

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTracks') {
                throw new Error('expected a restoreTracks inverse action');
            }
            expect(inverseAction.payload.restores).toEqual([snapshotT1, snapshotT2, snapshotT3]);
            expect(inverseAction.payload.restores.map((restore) => restore.trackIndex)).toEqual([0, 1, 2]);
            expect(desc.redoAction).toBe(action);
        });

        it('omits a track whose removal snapshot cannot be captured', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1' }, { id: 't2' }] });
            const snapshotT2 = createSnapshot('t2', 1);
            mocks.captureTrackRemovalSnapshot.mockImplementation((trackId: string) =>
                trackId === 't1' ? null : snapshotT2
            );

            const desc = handleRemoveAllTracks.describe({ type: 'removeAllTracks', payload: undefined });

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTracks') {
                throw new Error('expected a restoreTracks inverse action');
            }
            expect(inverseAction.payload.restores).toEqual([snapshotT2]);
        });
    });

    describe('isNoop', () => {
        it('is true for an empty project', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(handleRemoveAllTracks.isNoop?.({ type: 'removeAllTracks', payload: undefined })).toBe(true);
        });

        it('is false when tracks remain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1' }] });

            expect(handleRemoveAllTracks.isNoop?.({ type: 'removeAllTracks', payload: undefined })).toBe(false);
        });

        it('is true when track store state is unavailable', () => {
            mocks.getTrackStoreState.mockReturnValue(null);

            expect(handleRemoveAllTracks.isNoop?.({ type: 'removeAllTracks', payload: undefined })).toBe(true);
        });
    });

    it('is undoable', () => {
        expect(handleRemoveAllTracks.undoable).toBe(true);
    });
});
