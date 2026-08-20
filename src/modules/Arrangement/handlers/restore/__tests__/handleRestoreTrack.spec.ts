import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleRestoreTrack } from '../handleRestoreTrack';

import type { TakeLaneStoreState } from '../../../stores/takeLaneStore';
import type { TrackStoreState } from '../../../stores/trackStore';
import type { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import type { setTrackState } from '../../../useCases/setTrackState';

type RestoreTrackAction = Parameters<typeof handleRestoreTrack.execute>[0];
type RestoreTrackPayload = RestoreTrackAction['payload'];
type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: RestoreTrackPayload['midiNotesByClipId'][string] | null;
    controlChangeSnapshot: RestoreTrackPayload['midiCcByClipId'][string] | null;
    pitchBendSnapshot: RestoreTrackPayload['midiPitchBendByClipId'][string] | null;
};

const mocks = vi.hoisted(() => {
    const takeLaneStoreState: { value: TakeLaneStoreState | null } = { value: null };

    return {
        takeLaneStoreState,
        getTrackStoreState: vi.fn<typeof getTrackStoreState>(),
        setTrackState: vi.fn<typeof setTrackState>(),
        finalizeSidechainRestore: vi.fn(),
        ensureBusStrip: vi.fn(),
        projectTrackToLiveStrip: vi.fn(),
        publishTrackAdded: vi.fn(),
        refreshToasterPadBindings: vi.fn(),
        restoreAutomationLanes: vi.fn<(laneSnapshots: readonly unknown[]) => void>(),
        restoreSidechainRoutes: vi.fn(),
        restoreTrackModulationReferences: vi.fn(),
        setBusGain: vi.fn(),
        wireSidechainRoutes: vi.fn(),
        restoreMidiClipData: vi.fn<(input: RestoreMidiClipDataInput) => void>(),
        writeClipSatelliteEntry: vi.fn(),
        getTakeLaneStoreValue: vi.fn((): TakeLaneStoreState | null => takeLaneStoreState.value),
        setTakeLaneStore: vi.fn((nextState: TakeLaneStoreState): void => {
            takeLaneStoreState.value = nextState;
        }),
    };
});

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

vi.mock('../../../useCases/publishTrackAdded', () => ({
    publishTrackAdded: mocks.publishTrackAdded,
}));

vi.mock('../../../useCases/refreshToasterPadBindings', () => ({
    refreshToasterPadBindings: mocks.refreshToasterPadBindings,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationLanes: mocks.restoreAutomationLanes,
    restoreTrackModulationReferences: mocks.restoreTrackModulationReferences,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    ensureBusStrip: mocks.ensureBusStrip,
    restoreSidechainRoutes: mocks.restoreSidechainRoutes,
    setBusGain: mocks.setBusGain,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value(): TakeLaneStoreState | null {
            return mocks.getTakeLaneStoreValue();
        },
        set: mocks.setTakeLaneStore,
    },
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

function createRestoreTrackAction(overrides: Partial<RestoreTrackPayload> = {}): RestoreTrackAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId: 'track-1',
            trackSnapshot: { id: 'track-1' },
            trackName: 'Restored',
            trackKind: 'audio',
            trackGain: 0.8,
            trackParentId: null,
            trackIndex: 0,
            wasSelected: false,
            routingPatches: [],
            automationLaneSnapshots: [],
            clipSatellites: [],
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            takeLaneSnapshots: [],
            sidechainRouteSnapshots: [],
            ownedModulatorSnapshots: [],
            incomingModulationMappingSnapshots: [],
            ...overrides,
        },
    };
}

function requireCallOrder(callOrders: readonly number[], label: string): number {
    const callOrder = callOrders[0];
    if (callOrder === undefined) {
        throw new Error(`Expected ${label} to be called`);
    }

    return callOrder;
}

describe('handleRestoreTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.takeLaneStoreState.value = { lanes: [] };
        mocks.restoreSidechainRoutes.mockReturnValue(mocks.finalizeSidechainRestore);
    });

    it('restores project truth first and rebuilds live state only after commit', async () => {
        const trackState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const automationLaneSnapshots = [
            { id: 'lane-restored', trackId: 'track-1' },
        ] satisfies RestoreTrackPayload['automationLaneSnapshots'];
        const action = createRestoreTrackAction({
            automationLaneSnapshots,
            midiNotesByClipId: { 'clip-a': [], 'clip-b': [] },
            midiCcByClipId: { 'clip-a': [], 'clip-c': [] },
            midiPitchBendByClipId: { 'clip-b': [], 'clip-d': [] },
            takeLaneSnapshots: [{ id: 'take-restored', trackId: 'track-1' }],
        });
        mocks.getTrackStoreState.mockReturnValue(trackState);

        const result = await handleRestoreTrack.execute(action);

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            ...trackState,
            tracks: [action.payload.trackSnapshot],
        });
        expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith(action.payload.automationLaneSnapshots);
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(1, {
            clipId: 'clip-a',
            notesSnapshot: action.payload.midiNotesByClipId['clip-a'],
            controlChangeSnapshot: action.payload.midiCcByClipId['clip-a'],
            pitchBendSnapshot: null,
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(2, {
            clipId: 'clip-b',
            notesSnapshot: action.payload.midiNotesByClipId['clip-b'],
            controlChangeSnapshot: null,
            pitchBendSnapshot: action.payload.midiPitchBendByClipId['clip-b'],
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(3, {
            clipId: 'clip-c',
            notesSnapshot: null,
            controlChangeSnapshot: action.payload.midiCcByClipId['clip-c'],
            pitchBendSnapshot: null,
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(4, {
            clipId: 'clip-d',
            notesSnapshot: null,
            controlChangeSnapshot: null,
            pitchBendSnapshot: action.payload.midiPitchBendByClipId['clip-d'],
        });
        expect(mocks.setTakeLaneStore).toHaveBeenCalledWith({ lanes: action.payload.takeLaneSnapshots });
        expect(mocks.restoreTrackModulationReferences).toHaveBeenCalledWith({
            ownedModulators: action.payload.ownedModulatorSnapshots,
            incomingMappings: action.payload.incomingModulationMappingSnapshots,
        });
        expect(mocks.restoreSidechainRoutes).toHaveBeenCalledWith(action.payload.sidechainRouteSnapshots, {
            deferRuntimeEffect: true,
        });
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.finalizeSidechainRestore).not.toHaveBeenCalled();
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();

        const trackOrder = requireCallOrder(mocks.setTrackState.mock.invocationCallOrder, 'track restore');
        const automationOrder = requireCallOrder(
            mocks.restoreAutomationLanes.mock.invocationCallOrder,
            'automation restore'
        );
        const midiCallOrders = mocks.restoreMidiClipData.mock.invocationCallOrder;
        const midiOrder = requireCallOrder(midiCallOrders, 'MIDI restore');
        const finalMidiOrder = midiCallOrders.at(-1);
        if (finalMidiOrder === undefined) {
            throw new Error('Expected final MIDI restore call');
        }
        const takeLaneOrder = requireCallOrder(mocks.setTakeLaneStore.mock.invocationCallOrder, 'take-lane restore');

        expect(trackOrder).toBeLessThan(automationOrder);
        expect(automationOrder).toBeLessThan(midiOrder);
        expect(finalMidiOrder).toBeLessThan(takeLaneOrder);

        await result?.afterCommit?.();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'track-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
        expect(mocks.finalizeSidechainRestore).toHaveBeenCalledOnce();
        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: 'track-1',
            name: 'Restored',
            kind: 'audio',
        });
    });

    it('restores the gain envelope and warp state of every captured clip (regression #2108)', async () => {
        const trackState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const gainEnvelope = { clipId: 'c1', points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }], enabled: true };
        const clipSatellites = [{ clipId: 'c1', gainEnvelope, warpState: null }];
        const action = createRestoreTrackAction({ clipSatellites });
        mocks.getTrackStoreState.mockReturnValue(trackState);

        await handleRestoreTrack.execute(action);

        expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledWith(clipSatellites[0]);
    });

    it('should not call owners or write local state when every snapshot is empty', () => {
        void handleRestoreTrack.execute(createRestoreTrackAction());

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
        expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        expect(mocks.setTakeLaneStore).not.toHaveBeenCalled();
        expect(mocks.restoreTrackModulationReferences).not.toHaveBeenCalled();
        expect(mocks.restoreSidechainRoutes).not.toHaveBeenCalled();
        expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
    });

    it('rebuilds only a restored track present in durable truth after an ambiguous commit', async () => {
        const restored = TrackDummy.create({ id: 'track-1', name: 'Committed', kind: 'audio' });
        const initialState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const action = createRestoreTrackAction({ trackSnapshot: restored });
        mocks.getTrackStoreState.mockReturnValue(initialState);
        const result = await handleRestoreTrack.execute(action);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [restored],
            selectedTrackId: null,
            ghostClips: [],
        });

        await result?.afterAmbiguousCommit?.();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'track-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: 'track-1',
            name: 'Committed',
            kind: 'audio',
        });
    });

    it('still reconciles durable sidechain truth when the track restore did not commit', async () => {
        const initialState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        mocks.getTrackStoreState.mockReturnValue(initialState);
        const result = await handleRestoreTrack.execute(createRestoreTrackAction());

        await result?.afterAmbiguousCommit?.();

        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();
    });

    it('restores original ordering, selection, and survivor routing snapshots', async () => {
        const first = TrackDummy.create({ id: 'first', outputId: 'hw_out' });
        const removed = TrackDummy.create({ id: 'track-1', name: 'Bus', kind: 'bus' });
        const reconciled = TrackDummy.create({
            id: 'survivor',
            outputId: 'track-1',
            sends: [{ busId: 'track-1', level: 0.5, preFader: false }],
        });
        const currentSurvivor = { ...reconciled, outputId: 'hw_out', sends: [] };
        const state: TrackStoreState = {
            tracks: [first, currentSurvivor],
            selectedTrackId: null,
            ghostClips: [],
        };
        const action = createRestoreTrackAction({
            trackSnapshot: removed,
            trackName: removed.name,
            trackKind: removed.kind,
            trackGain: removed.gain,
            trackParentId: removed.parentId,
            trackIndex: 1,
            wasSelected: true,
            routingPatches: [
                {
                    trackId: 'survivor',
                    expected: { outputId: 'hw_out', sends: [] },
                    replacement: { outputId: 'track-1', sends: reconciled.sends },
                },
            ],
        });
        mocks.getTrackStoreState.mockReturnValue(state);

        const result = await handleRestoreTrack.execute(action);

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            ...state,
            tracks: [first, removed, { ...currentSurvivor, outputId: 'track-1', sends: reconciled.sends }],
            selectedTrackId: 'track-1',
        });

        await result?.afterCommit?.();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(1, {
            trackId: 'track-1',
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(2, {
            trackId: 'survivor',
            deferSidechainWiring: true,
        });
        expect(mocks.ensureBusStrip).toHaveBeenCalledWith('track-1');
        expect(mocks.setBusGain).toHaveBeenCalledWith('track-1', removed.gain);
        expect(mocks.refreshToasterPadBindings).toHaveBeenCalledWith(
            [first, removed, { ...currentSurvivor, outputId: 'track-1', sends: reconciled.sends }],
            removed.parentId
        );
    });

    it('defers sibling routing patches to their snapshots and offsets a still-missing earlier sibling', () => {
        const survivor = TrackDummy.create({ id: 'survivor' });
        const restored = TrackDummy.create({ id: 'track-b', outputId: 'master' });
        const state: TrackStoreState = {
            tracks: [survivor],
            selectedTrackId: null,
            ghostClips: [],
        };
        mocks.getTrackStoreState.mockReturnValue(state);
        const action = createRestoreTrackAction({
            trackId: restored.id,
            trackSnapshot: restored,
            trackName: restored.name,
            trackIndex: 1,
            batchRestoreTracks: [
                { trackId: 'track-a', trackIndex: 0 },
                { trackId: restored.id, trackIndex: 1 },
            ],
            routingPatches: [
                {
                    trackId: 'track-a',
                    expected: { outputId: 'master', sends: [] },
                    replacement: { outputId: restored.id, sends: [] },
                },
            ],
        });

        expect(handleRestoreTrack.execute(action)).toMatchObject({ status: 'written' });
        expect(mocks.setTrackState).toHaveBeenCalledWith({
            ...state,
            tracks: [restored, survivor],
        });
    });

    it('attempts sidechain wiring and publication when live strip projection fails', async () => {
        const failure = new Error('projection failed');
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        mocks.projectTrackToLiveStrip.mockImplementationOnce(() => {
            throw failure;
        });
        const result = await handleRestoreTrack.execute(createRestoreTrackAction());

        await expect(result?.afterCommit?.()).rejects.toBe(failure);

        expect(mocks.finalizeSidechainRestore).toHaveBeenCalledOnce();
        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: 'track-1',
            name: 'Restored',
            kind: 'audio',
        });
    });

    it('refreshes every Toaster sibling after restoring a removed middle child', async () => {
        const parent = TrackDummy.create({
            id: 'toaster-parent',
            kind: 'folder',
            devices: [{ id: 'toaster', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
        });
        const first = TrackDummy.create({ id: 'child-1', parentId: parent.id });
        const restored = TrackDummy.create({ id: 'child-2', parentId: parent.id });
        const third = TrackDummy.create({ id: 'child-3', parentId: parent.id });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [parent, first, third],
            selectedTrackId: null,
            ghostClips: [],
        });
        const result = await handleRestoreTrack.execute(
            createRestoreTrackAction({
                trackSnapshot: restored,
                trackName: restored.name,
                trackKind: restored.kind,
                trackGain: restored.gain,
                trackParentId: parent.id,
                trackIndex: 2,
            })
        );

        await result?.afterCommit?.();

        expect(mocks.refreshToasterPadBindings).toHaveBeenCalledWith([parent, first, restored, third], parent.id);
    });

    it('conflicts instead of overwriting a concurrent survivor routing edit', () => {
        const survivor = TrackDummy.create({ id: 'survivor', outputId: 'another-bus' });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [survivor],
            selectedTrackId: null,
            ghostClips: [],
        });
        const action = createRestoreTrackAction({
            routingPatches: [
                {
                    trackId: survivor.id,
                    expected: { outputId: 'master', sends: [] },
                    replacement: { outputId: 'track-1', sends: [] },
                },
            ],
        });

        expect(handleRestoreTrack.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('preserves a concurrent selection made after removal', () => {
        const selected = TrackDummy.create({ id: 'selected-later' });
        const state: TrackStoreState = {
            tracks: [selected],
            selectedTrackId: selected.id,
            ghostClips: [],
        };
        mocks.getTrackStoreState.mockReturnValue(state);

        handleRestoreTrack.execute(createRestoreTrackAction({ wasSelected: true }));

        expect(mocks.setTrackState).toHaveBeenCalledWith(expect.objectContaining({ selectedTrackId: selected.id }));
    });

    it('reports a conflict instead of duplicating an already-restored track', () => {
        const existing = TrackDummy.create({ id: 'track-1' });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [existing],
            selectedTrackId: existing.id,
            ghostClips: [],
        });

        expect(handleRestoreTrack.execute(createRestoreTrackAction())).toEqual({
            status: 'conflict',
        });

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
    });

    it('should provide a description and remain non-undoable', () => {
        expect(handleRestoreTrack.describe(createRestoreTrackAction())).toEqual({ label: 'Restore track' });
        expect(handleRestoreTrack.undoable).toBe(false);
    });

    it('skips the take-lane merge when the take-lane store holds no state', () => {
        const action = createRestoreTrackAction({
            takeLaneSnapshots: [{ id: 'take-restored', trackId: 'track-1' }],
        });
        // Take-lane snapshots are present, but the store itself is absent.
        mocks.takeLaneStoreState.value = null;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });

        void handleRestoreTrack.execute(action);

        // No merge attempted because there is no prior state to extend.
        expect(mocks.setTakeLaneStore).not.toHaveBeenCalled();
    });
});
