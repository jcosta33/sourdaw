import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';

import {
    createCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleRemoveAllTracks } from '../handleRemoveAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeTrack: vi.fn(),
    captureTrackRemovalSnapshot: vi.fn(),
    publishTrackRemoved: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    wireSidechainRoutes: vi.fn(),
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
vi.mock('../../../useCases/publishTrackRemoved', () => ({
    publishTrackRemoved: mocks.publishTrackRemoved,
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

function hostedDevice(trackId: string) {
    return { id: `${trackId}-plugin`, type: 'external-plugin', externalInstanceId: `${trackId}-instance` };
}
vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    wireSidechainRoutes: mocks.wireSidechainRoutes,
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

        it('defers every removal and notification until the transaction commits', async () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    { id: 't1', devices: [] },
                    { id: 't2', devices: [] },
                ],
            });
            const finalizeFirst = vi.fn();
            const finalizeSecond = vi.fn();
            mocks.removeTrack
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeFirst })
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeSecond });

            const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });

            expect(mocks.removeTrack).toHaveBeenCalledTimes(2);
            expect(mocks.removeTrack).toHaveBeenCalledWith('t1', {
                deferRuntimeEffects: true,
                suppressRemovedEvent: true,
            });
            expect(mocks.removeTrack).toHaveBeenCalledWith('t2', {
                deferRuntimeEffects: true,
                suppressRemovedEvent: true,
            });
            expect(finalizeFirst).not.toHaveBeenCalled();
            expect(finalizeSecond).not.toHaveBeenCalled();
            expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();

            await result?.afterCommit?.();

            expect(finalizeFirst).toHaveBeenCalledOnce();
            expect(finalizeSecond).toHaveBeenCalledOnce();
            expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 't1' });
            expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 't2' });
        });

        it('finalizes one track after another, so a later release waits for an earlier one', async () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    { id: 't1', devices: [hostedDevice('t1')] },
                    { id: 't2', devices: [hostedDevice('t2')] },
                ],
            });
            let settleFirst: () => void = () => undefined;
            const finalizeFirst = vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        settleFirst = resolve;
                    })
            );
            const finalizeSecond = vi.fn(() => Promise.resolve());
            mocks.removeTrack
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeFirst })
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeSecond });

            const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });
            const committed = result?.afterCommit?.();
            await Promise.resolve();

            expect(finalizeFirst).toHaveBeenCalledOnce();
            expect(finalizeSecond).not.toHaveBeenCalled();

            settleFirst();
            await committed;

            expect(finalizeSecond).toHaveBeenCalledOnce();
        });

        // #6557: the runtime removal, which releases a track's plugins, rechecks committed truth, so a
        // track a peer restored keeps its plugins, and a replaced project root releases nothing.
        describe('against a committed project root', () => {
            const finalizers: Record<string, ReturnType<typeof vi.fn>> = { t1: vi.fn(), t2: vi.fn() };
            beforeEach(() => {
                finalizers.t1?.mockReset();
                finalizers.t2?.mockReset();
                resetCrdtProjectAuthority('remove all tracks unload guard');
                removeCrdtDoc('root');
                createCrdtDoc('root');
                registerCrdtStorageRuntime();
                onTestFinished(() => removeCrdtDoc('root'));
                mocks.getTrackStoreState.mockReturnValue({
                    tracks: [
                        { id: 't1', devices: [hostedDevice('t1')] },
                        { id: 't2', devices: [hostedDevice('t2')] },
                    ],
                });
                mocks.removeTrack.mockImplementation((trackId: string) => ({
                    removed: true,
                    finalizeRuntimeRemoval: finalizers[trackId],
                }));
            });

            it('finalizes only the tracks committed truth no longer holds', async () => {
                const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });
                mutateCrdtDoc<{ tracks: unknown }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.tracks = { tracks: [TrackDummy.create({ id: 't1' })], selectedTrackId: null };
                    },
                });

                await result?.afterCommit?.();

                expect(finalizers.t1).not.toHaveBeenCalled();
                expect(finalizers.t2).toHaveBeenCalledOnce();
            });

            it('finalizes no track an ambiguous commit leaves in committed truth only', async () => {
                const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
                mutateCrdtDoc<{ tracks: unknown }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.tracks = { tracks: [TrackDummy.create({ id: 't1' })], selectedTrackId: null };
                    },
                });

                await result?.afterAmbiguousCommit?.();

                expect(finalizers.t1).not.toHaveBeenCalled();
                expect(finalizers.t2).toHaveBeenCalledOnce();
            });

            it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
                'releases nothing once the project root is replaced, phase=%s',
                async (phase) => {
                    const result = await handleRemoveAllTracks.execute({
                        type: 'removeAllTracks',
                        payload: undefined,
                    });
                    removeCrdtDoc('root');

                    await result?.[phase]?.();

                    expect(finalizers.t1).not.toHaveBeenCalled();
                    expect(finalizers.t2).not.toHaveBeenCalled();
                }
            );
        });

        it('reconciles only track IDs absent from committed truth after an ambiguous commit', async () => {
            mocks.getTrackStoreState
                .mockReturnValueOnce({
                    tracks: [
                        { id: 't1', devices: [hostedDevice('t1')] },
                        { id: 't2', devices: [hostedDevice('t2')] },
                    ],
                })
                .mockReturnValue({ tracks: [{ id: 't2', devices: [hostedDevice('t2')] }] });
            const finalizeFirst = vi.fn();
            const finalizeSecond = vi.fn();
            mocks.removeTrack
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeFirst })
                .mockReturnValueOnce({ removed: true, finalizeRuntimeRemoval: finalizeSecond });

            const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });
            await result?.afterAmbiguousCommit?.();

            expect(finalizeFirst).toHaveBeenCalledOnce();
            expect(finalizeSecond).not.toHaveBeenCalled();
            expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 't1' });
            expect(mocks.publishTrackRemoved).not.toHaveBeenCalledWith({ trackId: 't2' });
            expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
                trackId: 't2',
                activateDormantExternalPlugins: true,
            });
            expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
        });

        it('keeps runtime ownership when committed track state is unavailable', async () => {
            mocks.getTrackStoreState.mockReturnValueOnce({ tracks: [{ id: 't1', devices: [] }] }).mockReturnValue(null);
            const finalize = vi.fn();
            mocks.removeTrack.mockReturnValue({ removed: true, finalizeRuntimeRemoval: finalize });

            const result = await handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: undefined });
            expect(() => result?.afterAmbiguousCommit?.()).toThrow('Committed track state is unavailable');

            expect(finalize).not.toHaveBeenCalled();
            expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
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
                tracks: [
                    { id: 't1', devices: [] },
                    { id: 't2', devices: [] },
                    { id: 't3', devices: [] },
                ],
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

        it('leaves the master track out of the undo snapshot and treats a master-only project as a no-op', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 'master', kind: 'master', outputId: 'hw_out', sends: [] },
                ],
            });
            const snapshotT1 = createSnapshot('t1', 0);
            mocks.captureTrackRemovalSnapshot.mockReturnValue(snapshotT1);

            handleRemoveAllTracks.describe({ type: 'removeAllTracks', payload: undefined });

            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenCalledOnce();
            expect(mocks.captureTrackRemovalSnapshot).toHaveBeenCalledWith('t1');
            expect(handleRemoveAllTracks.isNoop?.({ type: 'removeAllTracks', payload: undefined })).toBe(false);

            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master' }] });
            expect(handleRemoveAllTracks.isNoop?.({ type: 'removeAllTracks', payload: undefined })).toBe(true);
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
