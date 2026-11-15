import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { sanitize_take_lane_store_state } from '../../../stores/takeLaneStore';
import { sanitizeTrackSnapshot } from '../../../stores/trackStore';
import { captureTrackRemovalSnapshot } from '../../../useCases/captureTrackRemovalSnapshot';
import { handleRestoreTracks } from '../../track/restoreTracks';
import { handleRestoreTrack } from '../handleRestoreTrack';

import type { TakeLane } from '../../../models/TakeLane';
import type { TakeLaneStoreState } from '../../../stores/takeLaneStore';
import type { Track, TrackStoreState } from '../../../stores/trackStore';
import type { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import type { setTrackState } from '../../../useCases/setTrackState';

type RestoreTrackAction = Parameters<typeof handleRestoreTrack.execute>[0];
type RestoreTrackPayload = RestoreTrackAction['payload'];
type CapturedMidiState = {
    notesByClipId: Record<string, readonly { readonly id: string }[]>;
    ccByClipId: Record<string, readonly { readonly id: string }[]>;
    pitchBendByClipId: Record<string, readonly { readonly id: string }[]>;
};
type SatelliteEntry = RestoreTrackPayload['clipSatellites'][number];
type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: RestoreTrackPayload['midiNotesByClipId'][string] | null;
    controlChangeSnapshot: RestoreTrackPayload['midiCcByClipId'][string] | null;
    pitchBendSnapshot: RestoreTrackPayload['midiPitchBendByClipId'][string] | null;
};

const mocks = vi.hoisted(() => {
    const takeLaneStoreState: { value: TakeLaneStoreState | null } = { value: null };
    const capturedStores: {
        midi: CapturedMidiState | null;
        automationLanes: RestoreTrackPayload['automationLaneSnapshots'] | null;
        modulators: RestoreTrackPayload['ownedModulatorSnapshots'] | null;
    } = { midi: null, automationLanes: null, modulators: null };

    return {
        takeLaneStoreState,
        capturedStores,
        readClipSatelliteEntry: vi.fn((clipId: string): SatelliteEntry => ({
            clipId,
            gainEnvelope: null,
            warpState: null,
        })),
        getTrackStoreState: vi.fn<typeof getTrackStoreState>(),
        setTrackState: vi.fn<typeof setTrackState>(),
        finalizeSidechainRestore: vi.fn(),
        ensureBusStrip: vi.fn(),
        projectTrackToLiveStrip: vi.fn(),
        rearmCommittedTrackInputMonitoring: vi.fn(async () => undefined),
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
        // Mimics the shared insert's append placement so index assertions stay
        // honest; its merge/liveness/track-exists rules are pinned by the
        // comping use case's own specs, not here.
        insertTakeLane: vi.fn((lane: TakeLaneStoreState['lanes'][number], index: number): void => {
            const state = takeLaneStoreState.value;
            if (!state) {
                return;
            }
            const lanes = [...state.lanes];
            lanes.splice(Math.min(index, lanes.length), 0, lane);
            takeLaneStoreState.value = { lanes };
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

// This unit spec owns the restore handler's runtime effects, not live CRDT root
// identity. Keep the root absent and stable; integration specs cover the actual
// command/CRDT fence and root-change behavior.
vi.mock(
    '#/modules/CrdtDocument/useCases',
    (): Pick<
        typeof import('#/modules/CrdtDocument/useCases'),
        'DOC_PREFIX_ROOT' | 'captureProjectRootIdentity' | 'getCrdtDoc'
    > => ({
        DOC_PREFIX_ROOT: 'root',
        captureProjectRootIdentity: () => 'restore-track-spec-root',
        getCrdtDoc: () => undefined,
    })
);

vi.mock('#/modules/AudioEngine/useCases', () => ({
    rearmCommittedTrackInputMonitoring: mocks.rearmCommittedTrackInputMonitoring,
}));

vi.mock('../../../useCases/refreshToasterPadBindings', () => ({
    refreshToasterPadBindings: mocks.refreshToasterPadBindings,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationLanes: mocks.restoreAutomationLanes,
    restoreTrackModulationReferences: mocks.restoreTrackModulationReferences,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    replaceFrozenMidiTakeRow: vi.fn(),
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    ensureBusStrip: mocks.ensureBusStrip,
    getAllSidechainRoutes: () => [],
    restoreSidechainRoutes: mocks.restoreSidechainRoutes,
    setBusGain: mocks.setBusGain,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

vi.mock('../../../stores/takeLaneStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/takeLaneStore')>()),
    takeLaneStore: {
        get value(): TakeLaneStoreState | null {
            return mocks.getTakeLaneStoreValue();
        },
        set: mocks.setTakeLaneStore,
    },
}));

vi.mock('../../../useCases/comping/insertTakeLane', () => ({
    insertTakeLane: mocks.insertTakeLane,
}));

// The removal capture reads these owners' stores; the restore writes them only
// through the mocked use cases above.
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value(): CapturedMidiState | null {
            return mocks.capturedStores.midi;
        },
    },
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/stores')>()),
    automationStore: {
        get value(): { lanes: RestoreTrackPayload['automationLaneSnapshots'] } | null {
            const lanes = mocks.capturedStores.automationLanes;
            return lanes ? { lanes } : null;
        },
    },
    modulationStore: {
        get value(): { modulators: RestoreTrackPayload['ownedModulatorSnapshots'] } | null {
            const modulators = mocks.capturedStores.modulators;
            return modulators ? { modulators } : null;
        },
    },
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

function takeLane(id: string, trackId: string): TakeLane {
    return { id, trackId, takes: [], activeCompRegions: [] };
}

function clipOf(trackId: string, id: string): Track['clips'][number] {
    return {
        id,
        trackId,
        name: id,
        type: 'midi',
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function createRestoreTrackAction(overrides: Partial<RestoreTrackPayload> = {}): RestoreTrackAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId: 'track-1',
            trackSnapshot: TrackDummy.create({ id: 'track-1' }),
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
        mocks.capturedStores.midi = null;
        mocks.capturedStores.automationLanes = null;
        mocks.capturedStores.modulators = null;
        mocks.readClipSatelliteEntry.mockImplementation((clipId) => ({ clipId, gainEnvelope: null, warpState: null }));
        mocks.restoreSidechainRoutes.mockReturnValue(mocks.finalizeSidechainRestore);
    });

    it('restores project truth first and rebuilds live state only after commit', async () => {
        const trackState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const automationLaneSnapshots = [
            { id: 'lane-restored', trackId: 'track-1' },
        ] satisfies RestoreTrackPayload['automationLaneSnapshots'];
        const action = createRestoreTrackAction({
            trackSnapshot: TrackDummy.create({
                id: 'track-1',
                clips: ['clip-a', 'clip-b', 'clip-c', 'clip-d'].map((clipId) => clipOf('track-1', clipId)),
            }),
            automationLaneSnapshots,
            midiNotesByClipId: { 'clip-a': [], 'clip-b': [] },
            midiCcByClipId: { 'clip-a': [], 'clip-c': [] },
            midiPitchBendByClipId: { 'clip-b': [], 'clip-d': [] },
            takeLaneSnapshots: [takeLane('take-restored', 'track-1')],
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
        // Each captured lane goes through the shared insert, which owns the
        // one-lane-per-track merge — never a blind append (#4527).
        expect(mocks.insertTakeLane).toHaveBeenCalledTimes(1);
        expect(mocks.insertTakeLane).toHaveBeenCalledWith(action.payload.takeLaneSnapshots[0], 0);
        expect(mocks.restoreTrackModulationReferences).toHaveBeenCalledWith({
            ownedModulators: action.payload.ownedModulatorSnapshots,
            incomingMappings: action.payload.incomingModulationMappingSnapshots,
        });
        expect(mocks.restoreSidechainRoutes).toHaveBeenCalledWith(action.payload.sidechainRouteSnapshots, {
            deferRuntimeEffect: true,
        });
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.finalizeSidechainRestore).not.toHaveBeenCalled();

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
        const takeLaneOrder = requireCallOrder(mocks.insertTakeLane.mock.invocationCallOrder, 'take-lane restore');

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
    });

    it('restores the gain envelope and warp state of every captured clip (regression #2108)', async () => {
        const trackState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        const gainEnvelope = { clipId: 'c1', points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }], enabled: true };
        const clipSatellites = [{ clipId: 'c1', gainEnvelope, warpState: null }];
        const action = createRestoreTrackAction({
            trackSnapshot: TrackDummy.create({ id: 'track-1', clips: [clipOf('track-1', 'c1')] }),
            clipSatellites,
        });
        mocks.getTrackStoreState.mockReturnValue(trackState);

        await handleRestoreTrack.execute(action);

        expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledWith(clipSatellites[0]);
    });

    it('should not call owners or write local state when every snapshot is empty', () => {
        void handleRestoreTrack.execute(createRestoreTrackAction());

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
        expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        expect(mocks.insertTakeLane).not.toHaveBeenCalled();
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
    });

    it('still reconciles durable sidechain truth when the track restore did not commit', async () => {
        const initialState: TrackStoreState = { tracks: [], selectedTrackId: null, ghostClips: [] };
        mocks.getTrackStoreState.mockReturnValue(initialState);
        const result = await handleRestoreTrack.execute(createRestoreTrackAction());

        await result?.afterAmbiguousCommit?.();

        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.rearmCommittedTrackInputMonitoring).not.toHaveBeenCalled();
    });

    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'delegates current committed admission after strip rebuilding in %s',
        async (hook) => {
            const restored = TrackDummy.create({
                id: 'track-1',
                kind: 'midi',
                inputMonitoring: 'on',
                inputId: 'mic-a',
            });
            const survivor = TrackDummy.create({ id: 'survivor', inputMonitoring: 'on', inputId: 'mic-b' });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [survivor], selectedTrackId: null, ghostClips: [] });
            const result = await handleRestoreTrack.execute(
                createRestoreTrackAction({
                    trackSnapshot: restored,
                    trackKind: restored.kind,
                })
            );
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [restored, survivor],
                selectedTrackId: null,
                ghostClips: [],
            });

            await result?.[hook]?.();

            expect(mocks.rearmCommittedTrackInputMonitoring).toHaveBeenCalledExactlyOnceWith(restored.id);
            expect(
                requireCallOrder(mocks.projectTrackToLiveStrip.mock.invocationCallOrder, 'strip rebuilding')
            ).toBeLessThan(
                requireCallOrder(mocks.rearmCommittedTrackInputMonitoring.mock.invocationCallOrder, 'monitor rearm')
            );
        }
    );

    it('leaves owner admission to the committed reader after a normal commit callback', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        const result = await handleRestoreTrack.execute(createRestoreTrackAction());

        await result?.afterCommit?.();

        expect(mocks.rearmCommittedTrackInputMonitoring).toHaveBeenCalledExactlyOnceWith('track-1');
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

    it('attempts sidechain wiring when live strip projection fails', async () => {
        const failure = new Error('projection failed');
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        mocks.projectTrackToLiveStrip.mockImplementationOnce(() => {
            throw failure;
        });
        const result = await handleRestoreTrack.execute(createRestoreTrackAction());

        await expect(result?.afterCommit?.()).rejects.toBe(failure);

        expect(mocks.finalizeSidechainRestore).toHaveBeenCalledOnce();
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
                trackId: restored.id,
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

    it('preserves a concurrent selection made after removal', async () => {
        const selected = TrackDummy.create({ id: 'selected-later' });
        const state: TrackStoreState = {
            tracks: [selected],
            selectedTrackId: selected.id,
            ghostClips: [],
        };
        mocks.getTrackStoreState.mockReturnValue(state);

        await handleRestoreTrack.execute(createRestoreTrackAction({ wasSelected: true }));

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

    it('delegates to the shared insert, which itself no-ops when the take-lane store holds no state', () => {
        const action = createRestoreTrackAction({
            takeLaneSnapshots: [takeLane('take-restored', 'track-1')],
        });
        // Take-lane snapshots are present, but the store itself is absent.
        mocks.takeLaneStoreState.value = null;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });

        void handleRestoreTrack.execute(action);

        // The handler delegates every snapshot; the absent-store guard lives in
        // `insertTakeLane`, so no write reaches the store.
        expect(mocks.insertTakeLane).toHaveBeenCalledTimes(1);
        expect(mocks.insertTakeLane).toHaveBeenCalledWith(action.payload.takeLaneSnapshots[0], 0);
        expect(mocks.setTakeLaneStore).not.toHaveBeenCalled();
    });

    it('routes every captured take lane through the shared insert merge, in payload order (#4527)', async () => {
        // A projection that gave the track a lane while it was removed must not
        // end up sharing the track with a second appended lane: the handler
        // delegates each snapshot to `insertTakeLane`, whose reconcile enforces
        // one lane per track.
        const action = createRestoreTrackAction({
            takeLaneSnapshots: [takeLane('lane-a', 'track-1'), takeLane('lane-b', 'track-1')],
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });

        const result = await handleRestoreTrack.execute(action);

        if (!result || result.status !== 'written') {
            throw new Error('expected a written result');
        }
        expect(mocks.insertTakeLane).toHaveBeenCalledTimes(2);
        expect(mocks.insertTakeLane).toHaveBeenNthCalledWith(1, takeLane('lane-a', 'track-1'), 0);
        expect(mocks.insertTakeLane).toHaveBeenNthCalledWith(2, takeLane('lane-b', 'track-1'), 1);
    });

    describe('a captured track row', () => {
        const removedTrackId = 'track-1';
        const survivorClipId = 'clip-survivor';
        const survivor = TrackDummy.create({ id: 'survivor', clips: [clipOf('survivor', survivorClipId)] });
        const survivorLane = takeLane('survivor-lane', survivor.id);

        function requireDefined<T>(value: T | undefined, label: string): T {
            if (value === undefined) {
                throw new Error(`Expected ${label}`);
            }
            return value;
        }

        // Rows the stores themselves would hold, built through their own projections.
        function storeTrackRow(overrides: Partial<Track> = {}): Track {
            const clip = {
                trackId: removedTrackId,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            };
            const zeroLength = {
                ...clip,
                id: 'clip-zero',
                name: 'Zero',
                type: 'midi',
                startBeat: 8,
                endBeat: 8,
            } as const;
            const preRoll = {
                ...clip,
                id: 'clip-pre-roll',
                name: 'Pre-roll',
                type: 'audio',
                startBeat: -2,
                endBeat: 2,
            } as const;
            const raw = TrackDummy.create({
                id: removedTrackId,
                kind: 'midi',
                clips: [zeroLength, preRoll],
                activeAlternativeId: 'alt-1',
                alternatives: [
                    { id: 'alt-1', name: 'Alternative 1', clips: [zeroLength] },
                    { id: 'alt-2', name: 'Alternative 2', clips: [preRoll] },
                ],
                ...overrides,
            });
            return requireDefined(
                sanitizeTrackSnapshot({ tracks: [raw], selectedTrackId: null }).tracks[0],
                'a projected track row'
            );
        }

        function storeTakeLane(): TakeLane {
            const lane = requireDefined(
                sanitize_take_lane_store_state({
                    lanes: [
                        {
                            id: 'lane-1',
                            trackId: removedTrackId,
                            takes: [
                                {
                                    id: 'take-1',
                                    clipId: 'clip-pre-roll',
                                    name: 'Take 1',
                                    startBeat: 0,
                                    endBeat: 2,
                                    selected: true,
                                },
                            ],
                            activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take-1' }],
                        },
                    ],
                }).lanes[0],
                'a projected take lane'
            );
            expect(lane.takes).toHaveLength(1);
            expect(lane.activeCompRegions).toHaveLength(1);
            return lane;
        }

        function captureRemoval(row: Track, lane: TakeLane): RestoreTrackPayload {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [survivor, row],
                selectedTrackId: removedTrackId,
                ghostClips: [],
            });
            mocks.takeLaneStoreState.value = { lanes: [survivorLane, lane] };
            const snapshot = requireDefined(
                captureTrackRemovalSnapshot(removedTrackId) ?? undefined,
                'a removal snapshot'
            );
            mocks.getTrackStoreState.mockReturnValue({ tracks: [survivor], selectedTrackId: null, ghostClips: [] });
            mocks.takeLaneStoreState.value = { lanes: [survivorLane] };
            return snapshot;
        }

        // Clip-keyed payload a refused restore must not write either.
        function withClipData(payload: RestoreTrackPayload): RestoreTrackPayload {
            const gainEnvelope = { clipId: 'clip-zero', points: [], enabled: true };
            return {
                ...payload,
                midiNotesByClipId: { 'clip-zero': [] },
                clipSatellites: [{ clipId: 'clip-zero', gainEnvelope, warpState: null }],
            };
        }

        function expectNothingWritten(action: RestoreTrackAction): void {
            expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
            expect(handleRestoreTrack.execute(action)).toEqual({ status: 'conflict' });
            expect(mocks.setTrackState).not.toHaveBeenCalled();
            expect(mocks.insertTakeLane).not.toHaveBeenCalled();
            expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
            expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
            expect(mocks.restoreTrackModulationReferences).not.toHaveBeenCalled();
            expect(mocks.takeLaneStoreState.value).toEqual({ lanes: [survivorLane] });
        }

        function withExtraClip(row: Track, clip: unknown): unknown {
            return { ...row, clips: [...row.clips, clip] };
        }

        function withExtraAlternativeClip(row: Track, clip: unknown): unknown {
            return {
                ...row,
                alternatives: row.alternatives.map((alternative) => ({
                    ...alternative,
                    clips: [...alternative.clips, clip],
                })),
            };
        }

        function anotherTracksClip(row: Track): unknown {
            const clip = requireDefined(row.clips[0], 'a stored clip');
            return { ...clip, id: 'clip-foreign', trackId: survivor.id };
        }

        it('restores a row holding a zero-length clip and a clip before beat 0, with its take lane, exactly', () => {
            const row = storeTrackRow();
            const lane = storeTakeLane();
            const action: RestoreTrackAction = { type: 'restoreTrack', payload: captureRemoval(row, lane) };

            expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            expect(handleRestoreTrack.execute(action)).toMatchObject({ status: 'written' });

            const written = mocks.setTrackState.mock.calls[0]?.[0];
            expect(written?.tracks).toStrictEqual([survivor, row]);
            expect(written?.selectedTrackId).toBe(removedTrackId);
            expect(mocks.insertTakeLane).toHaveBeenCalledOnce();
            expect(mocks.insertTakeLane.mock.calls[0]?.[0]).toStrictEqual(lane);
            expect(mocks.takeLaneStoreState.value?.lanes).toStrictEqual([survivorLane, lane]);
        });

        it.each([
            ['carries no kind', (row: Track) => ({ ...row, kind: undefined })],
            ['carries an unknown kind', (row: Track) => ({ ...row, kind: 'video' })],
            ['is not an object', () => null],
            ['belongs to another track', (row: Track) => ({ ...row, id: 'track-2' })],
            ['holds a malformed clip', (row: Track) => withExtraClip(row, { id: 'clip-broken' })],
            [
                'holds a malformed clip in an alternative',
                (row: Track) => withExtraAlternativeClip(row, { id: 'clip-broken' }),
            ],
            ['holds a malformed device', (row: Track) => ({ ...row, devices: [{ id: 'device-broken' }] })],
            ['holds a malformed send', (row: Track) => ({ ...row, sends: [{ level: 1 }] })],
            ['holds a clip of another track', (row: Track) => withExtraClip(row, anotherTracksClip(row))],
            [
                'holds an alternative clip of another track',
                (row: Track) => withExtraAlternativeClip(row, anotherTracksClip(row)),
            ],
        ])('refuses before any write when the track snapshot %s', (_label, corrupt) => {
            const payload = captureRemoval(storeTrackRow(), storeTakeLane());
            const trackSnapshot: unknown = corrupt(storeTrackRow());

            expectNothingWritten({
                type: 'restoreTrack',
                payload: withClipData({
                    ...payload,
                    trackSnapshot: trackSnapshot as RestoreTrackPayload['trackSnapshot'],
                }),
            });
        });

        it.each([
            ['carries no comp regions', (lane: TakeLane) => ({ ...lane, activeCompRegions: undefined })],
            ['carries a key the store never writes', (lane: TakeLane) => ({ ...lane, extra: true })],
            ['belongs to another track', (lane: TakeLane) => ({ ...lane, trackId: survivor.id })],
        ])('refuses before any write when a take-lane snapshot %s', (_label, corrupt) => {
            const payload = captureRemoval(storeTrackRow(), storeTakeLane());
            const corrupted: unknown = corrupt(storeTakeLane());

            expectNothingWritten({
                type: 'restoreTrack',
                payload: withClipData({
                    ...payload,
                    takeLaneSnapshots: [corrupted as RestoreTrackPayload['takeLaneSnapshots'][number]],
                }),
            });
        });

        // Every member a removal of this row captures: MIDI and a satellite on its
        // zero-length clip and on a clip only an inactive alternative holds, and an
        // automation lane of the track.
        function rowWithAlternativeOnlyClip(overrides: Partial<Track> = {}): Track {
            const base = storeTrackRow(overrides);
            return {
                ...base,
                alternatives: [
                    ...base.alternatives,
                    { id: 'alt-3', name: 'Alternative 3', clips: [clipOf(removedTrackId, 'clip-alt-only')] },
                ],
            };
        }

        function seedCapturedMembers(): void {
            const rows = { notes: [{ id: 'note-1' }], cc: [{ id: 'cc-1' }], bend: [{ id: 'bend-1' }] };
            mocks.capturedStores.midi = {
                notesByClipId: { 'clip-zero': rows.notes, 'clip-alt-only': rows.notes, [survivorClipId]: rows.notes },
                ccByClipId: { 'clip-alt-only': rows.cc, [survivorClipId]: rows.cc },
                pitchBendByClipId: { 'clip-zero': rows.bend, [survivorClipId]: rows.bend },
            };
            mocks.capturedStores.automationLanes = [
                { id: 'lane-own', trackId: removedTrackId },
                { id: 'lane-survivor', trackId: survivor.id },
            ];
            mocks.readClipSatelliteEntry.mockImplementation((clipId) => ({
                clipId,
                gainEnvelope: { clipId, points: [], enabled: true },
                warpState: null,
            }));
        }

        function captureWithMembers(row: Track): RestoreTrackPayload {
            seedCapturedMembers();
            const payload = captureRemoval(row, storeTakeLane());
            vi.clearAllMocks();
            return payload;
        }

        function expectRestored(action: RestoreTrackAction, row: Track): void {
            expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            expect(handleRestoreTrack.execute(action)).toMatchObject({ status: 'written' });
            expect(mocks.setTrackState.mock.calls[0]?.[0].tracks).toStrictEqual([survivor, row]);
        }

        it('captures the members of a row holding a zero-length clip and an alternative-only clip, and restores them', () => {
            const row = rowWithAlternativeOnlyClip();
            const payload = captureWithMembers(row);

            expect(Object.keys(payload.midiNotesByClipId).sort()).toEqual(['clip-alt-only', 'clip-zero']);
            expect(Object.keys(payload.midiCcByClipId)).toEqual(['clip-alt-only']);
            expect(Object.keys(payload.midiPitchBendByClipId)).toEqual(['clip-zero']);
            expect(payload.clipSatellites.map((entry) => entry.clipId).sort()).toEqual([
                'clip-alt-only',
                'clip-pre-roll',
                'clip-zero',
            ]);
            expect(payload.automationLaneSnapshots).toEqual([{ id: 'lane-own', trackId: removedTrackId }]);

            expectRestored({ type: 'restoreTrack', payload }, row);
            expect(mocks.restoreMidiClipData.mock.calls.map(([input]) => input.clipId).sort()).toEqual([
                'clip-alt-only',
                'clip-zero',
            ]);
            expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledTimes(3);
            expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith(payload.automationLaneSnapshots);
        });

        function modulator(
            id: string,
            trackId: string,
            targetTrackIds: readonly string[]
        ): RestoreTrackPayload['ownedModulatorSnapshots'][number] {
            return {
                id,
                name: id,
                trackId,
                enabled: true,
                kind: 'step',
                config: { kind: 'step', steps: [0, 1], rate: 1, smooth: 0 },
                mappings: targetTrackIds.map((targetTrackId) => ({
                    targetTrackId,
                    targetDeviceId: 'device-1',
                    targetParamId: 'param-1',
                    amount: 0.5,
                })),
            };
        }

        // `moveClip` writes no take, so a lane left on the old track keeps naming
        // a clip a survivor now holds. The capture emits it, so the restore must
        // accept it: a take's clip id cannot tell this state from a forged one.
        it('restores a take lane whose take names a clip that moved to a survivor', () => {
            const lane = storeTakeLane();
            const [take] = lane.takes;
            const movedLane = { ...lane, takes: [{ ...requireDefined(take, 'a take'), clipId: survivorClipId }] };
            const row = storeTrackRow();
            const payload = captureRemoval(row, movedLane);
            expect(payload.takeLaneSnapshots).toStrictEqual([movedLane]);

            expectRestored({ type: 'restoreTrack', payload }, row);
            expect(mocks.insertTakeLane.mock.calls[0]?.[0]).toStrictEqual(movedLane);
        });

        describe('modulation members', () => {
            const owned = modulator('mod-owned', removedTrackId, [survivor.id, removedTrackId]);
            const survivorModulator = modulator('mod-survivor', survivor.id, [removedTrackId, survivor.id]);

            function captureModulation(): RestoreTrackPayload {
                mocks.capturedStores.modulators = [owned, survivorModulator];
                const payload = captureRemoval(storeTrackRow(), storeTakeLane());
                vi.clearAllMocks();
                return payload;
            }

            it('restores an owned modulator that maps another track and an incoming mapping, exactly', () => {
                const payload = captureModulation();
                expect(payload.ownedModulatorSnapshots).toStrictEqual([owned]);
                expect(payload.incomingModulationMappingSnapshots).toStrictEqual([
                    { modulatorId: 'mod-survivor', mapping: survivorModulator.mappings[0] },
                ]);
                const action: RestoreTrackAction = { type: 'restoreTrack', payload };

                expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
                expect(handleRestoreTrack.execute(action)).toMatchObject({ status: 'written' });
                expect(mocks.restoreTrackModulationReferences).toHaveBeenCalledWith({
                    ownedModulators: payload.ownedModulatorSnapshots,
                    incomingMappings: payload.incomingModulationMappingSnapshots,
                });
            });

            it('refuses before any write an incoming mapping that targets another track', () => {
                const payload = captureModulation();
                const foreign = survivorModulator.mappings[1];
                if (!foreign) {
                    throw new Error('Expected a foreign mapping');
                }

                expectNothingWritten({
                    type: 'restoreTrack',
                    payload: {
                        ...payload,
                        incomingModulationMappingSnapshots: [
                            ...payload.incomingModulationMappingSnapshots,
                            { modulatorId: 'mod-survivor', mapping: foreign },
                        ],
                    },
                });
            });

            it('refuses before any write an owned modulator that belongs to another track', () => {
                const payload = captureModulation();

                expectNothingWritten({
                    type: 'restoreTrack',
                    payload: {
                        ...payload,
                        ownedModulatorSnapshots: [
                            ...payload.ownedModulatorSnapshots,
                            modulator('mod-unused', survivor.id, []),
                        ],
                    },
                });
            });
        });

        // A clip automation lane rides its clip's id; the contract type names
        // only the lane's identity, while the capture copies the whole lane.
        function clipLane(id: string, clipId: string): RestoreTrackPayload['automationLaneSnapshots'][number] {
            const lane = { id, trackId: removedTrackId, clipId };
            return lane;
        }

        it('restores clip automation lanes on its own live clip and on a clip only an alternative holds', () => {
            const row = rowWithAlternativeOnlyClip();
            seedCapturedMembers();
            const ownClipLanes = [clipLane('lane-clip-zero', 'clip-zero'), clipLane('lane-alt-only', 'clip-alt-only')];
            const existingLanes = mocks.capturedStores.automationLanes;
            if (existingLanes === null) {
                mocks.capturedStores.automationLanes = ownClipLanes;
            } else {
                mocks.capturedStores.automationLanes = [...existingLanes, ...ownClipLanes];
            }
            const payload = captureRemoval(row, storeTakeLane());
            vi.clearAllMocks();

            expect(payload.automationLaneSnapshots).toEqual([
                { id: 'lane-own', trackId: removedTrackId },
                ...ownClipLanes,
            ]);
            expectRestored({ type: 'restoreTrack', payload }, row);
            expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith(payload.automationLaneSnapshots);
        });

        // Deleting an alternative drops its clips and leaves their clip lanes
        // on the track; a removal captures them with the track's other lanes.
        it('restores a clip automation lane whose clip no clip list holds any more', async () => {
            const row = storeTrackRow();
            const orphanedLane = clipLane('lane-dropped', 'clip-dropped');
            mocks.capturedStores.automationLanes = [orphanedLane];
            const payload = captureRemoval(row, storeTakeLane());
            vi.clearAllMocks();
            const action: RestoreTrackAction = { type: 'restoreTrack', payload };

            expect(payload.automationLaneSnapshots).toEqual([orphanedLane]);
            expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            const result = await handleRestoreTrack.execute(action);
            expect(result).toMatchObject({ status: 'written' });
            expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith([orphanedLane]);
        });

        function withoutClipKeyedMembers(payload: RestoreTrackPayload): RestoreTrackPayload {
            return {
                ...payload,
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
                clipSatellites: [],
            };
        }

        function survivorsClipIdOnRow(row: Track): unknown {
            const clip = requireDefined(row.clips[0], 'a stored clip');
            return { ...clip, id: survivorClipId };
        }

        it.each([
            [
                'on its live clips, with no member keyed to it',
                (row: Track) => withExtraClip(row, survivorsClipIdOnRow(row)),
                withoutClipKeyedMembers,
            ],
            [
                'on its live clips, with MIDI keyed to it',
                (row: Track) => withExtraClip(row, survivorsClipIdOnRow(row)),
                (payload: RestoreTrackPayload) => ({
                    ...withoutClipKeyedMembers(payload),
                    midiNotesByClipId: { [survivorClipId]: [] },
                }),
            ],
            [
                'in an inactive alternative',
                (row: Track) => withExtraAlternativeClip(row, survivorsClipIdOnRow(row)),
                withoutClipKeyedMembers,
            ],
        ])("refuses before any write when the row holds a survivor's live clip id %s", (_label, corrupt, members) => {
            const payload = captureRemoval(storeTrackRow(), storeTakeLane());
            const trackSnapshot: unknown = corrupt(storeTrackRow());

            expectNothingWritten({
                type: 'restoreTrack',
                payload: members({ ...payload, trackSnapshot: trackSnapshot as RestoreTrackPayload['trackSnapshot'] }),
            });
        });

        // The state a cross-track move leaves: the moved clip is live on the
        // target, and the source's active alternative still holds it in the
        // stored copy, which only a switch or a create refreshes.
        const movedClipId = 'clip-moved';

        function rowWithStaleMovedClip(): Track {
            const base = storeTrackRow();
            return {
                ...base,
                alternatives: base.alternatives.map((alternative) => {
                    if (alternative.id !== base.activeAlternativeId) {
                        return alternative;
                    }
                    return { ...alternative, clips: [...alternative.clips, clipOf(removedTrackId, movedClipId)] };
                }),
            };
        }

        const moveTarget = TrackDummy.create({
            id: survivor.id,
            clips: [...survivor.clips, clipOf(survivor.id, movedClipId)],
        });

        // Captures the removal of `row` while the survivor holds the moved clip
        // live, with MIDI and a gain envelope on it, then leaves the survivor alone.
        function captureBesideMoveTarget(row: Track): RestoreTrackPayload {
            mocks.capturedStores.midi = {
                notesByClipId: { [movedClipId]: [{ id: 'note-moved' }], 'clip-zero': [{ id: 'note-zero' }] },
                ccByClipId: { [movedClipId]: [{ id: 'cc-moved' }] },
                pitchBendByClipId: { [movedClipId]: [{ id: 'bend-moved' }] },
            };
            mocks.readClipSatelliteEntry.mockImplementation((clipId) => ({
                clipId,
                gainEnvelope: clipId === movedClipId ? { clipId, points: [], enabled: true } : null,
                warpState: null,
            }));
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [moveTarget, row],
                selectedTrackId: null,
                ghostClips: [],
            });
            mocks.takeLaneStoreState.value = { lanes: [survivorLane] };
            const payload = requireDefined(
                captureTrackRemovalSnapshot(removedTrackId) ?? undefined,
                'a removal snapshot'
            );
            mocks.getTrackStoreState.mockReturnValue({ tracks: [moveTarget], selectedTrackId: null, ghostClips: [] });
            vi.clearAllMocks();
            return payload;
        }

        // The state a cross-track move leaves: the moved clip is live on the
        // target, and the source's active alternative still holds it in the
        // stored copy, which only a switch or a create refreshes. The capture
        // keys only held clips, so it carries nothing of the moved clip.
        it("restores a row whose active alternative's stale copy holds a clip since moved to a survivor", () => {
            const row = rowWithStaleMovedClip();
            const payload = captureBesideMoveTarget(row);
            const action: RestoreTrackAction = { type: 'restoreTrack', payload };

            expect(payload.midiNotesByClipId).toEqual({ 'clip-zero': [{ id: 'note-zero' }] });
            expect(payload.midiCcByClipId).toEqual({});
            expect(payload.midiPitchBendByClipId).toEqual({});
            expect(payload.clipSatellites).toEqual([]);
            expect(handleRestoreTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            expect(handleRestoreTrack.execute(action)).toMatchObject({ status: 'written' });
            expect(mocks.setTrackState.mock.calls[0]?.[0].tracks).toStrictEqual([moveTarget, row]);
            expect(mocks.restoreMidiClipData.mock.calls.map(([input]) => input.clipId)).toEqual(['clip-zero']);
            expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
        });

        it.each([
            ['MIDI notes', () => ({ midiNotesByClipId: { [movedClipId]: [] } })],
            ['MIDI controllers', () => ({ midiCcByClipId: { [movedClipId]: [] } })],
            ['MIDI pitch bend', () => ({ midiPitchBendByClipId: { [movedClipId]: [] } })],
            [
                'a satellite',
                () => ({
                    clipSatellites: [
                        {
                            clipId: movedClipId,
                            gainEnvelope: { clipId: movedClipId, points: [], enabled: true },
                            warpState: null,
                        },
                    ],
                }),
            ],
            ['a clip automation lane', () => ({ automationLaneSnapshots: [clipLane('lane-moved', movedClipId)] })],
        ])(
            'refuses before any write a payload keying %s by a stale-copy clip a survivor holds',
            (_label, members: () => Partial<RestoreTrackPayload>) => {
                const payload = captureBesideMoveTarget(rowWithStaleMovedClip());

                expectNothingWritten({ type: 'restoreTrack', payload: { ...payload, ...members() } });
            }
        );

        describe('a grouped restore of all tracks', () => {
            function groupedRow(trackId: string, clipId: string): RestoreTrackPayload {
                const row = requireDefined(
                    sanitizeTrackSnapshot({
                        tracks: [TrackDummy.create({ id: trackId, clips: [clipOf(trackId, clipId)] })],
                        selectedTrackId: null,
                    }).tracks[0],
                    'a projected track row'
                );
                return createRestoreTrackAction({
                    trackId,
                    trackSnapshot: row,
                    trackKind: row.kind,
                    trackParentId: row.parentId,
                    trackIndex: trackId === 'track-1' ? 1 : 2,
                }).payload;
            }

            // Each member reads the state the earlier members wrote.
            function trackStoreThroughWrites(): () => readonly string[] {
                let current: TrackStoreState = { tracks: [survivor], selectedTrackId: null, ghostClips: [] };
                mocks.getTrackStoreState.mockImplementation(() => current);
                mocks.setTrackState.mockImplementation((next) => {
                    current = next;
                });
                return () => current.tracks.map((track) => track.id);
            }

            it('restores two tracks holding distinct clips', () => {
                const trackIds = trackStoreThroughWrites();
                const result = handleRestoreTracks.execute({
                    type: 'restoreTracks',
                    payload: { restores: [groupedRow('track-1', 'clip-a'), groupedRow('track-2', 'clip-b')] },
                });

                expect(result).toMatchObject({ status: 'written' });
                expect(trackIds()).toEqual([survivor.id, 'track-1', 'track-2']);
            });

            it('refuses the member that reuses a clip id an earlier member restored', () => {
                const trackIds = trackStoreThroughWrites();
                const result = handleRestoreTracks.execute({
                    type: 'restoreTracks',
                    payload: {
                        restores: [groupedRow('track-1', 'clip-shared'), groupedRow('track-2', 'clip-shared')],
                    },
                });

                // The conflict aborts the action's transaction; the second
                // member itself writes nothing.
                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.setTrackState).toHaveBeenCalledOnce();
                expect(trackIds()).toEqual([survivor.id, 'track-1']);
            });
        });

        it.each([
            ['a folder child', { parentId: 'folder-1' }],
            ['a top-level track', { parentId: null }],
            ['a bus', { kind: 'bus' as const, clips: [], alternatives: [] }],
            ['an empty track', { clips: [], alternatives: [] }],
        ])('restores the captured removal of %s', (_label, overrides: Partial<Track>) => {
            const row = storeTrackRow(overrides);
            const payload = captureWithMembers(row);

            expect(payload.trackKind).toBe(row.kind);
            expect(payload.trackParentId).toBe(row.parentId);
            expectRestored({ type: 'restoreTrack', payload }, row);
        });

        it('restores a payload whose parent id was dropped by serialization of a top-level track', () => {
            const row = storeTrackRow();
            const { trackParentId: _dropped, ...payload } = captureWithMembers(row);

            expectRestored({ type: 'restoreTrack', payload: payload as RestoreTrackPayload }, row);
        });

        it('does not create a bus strip for a bus payload refused for its row kind', async () => {
            const payload = captureWithMembers(storeTrackRow());
            const result = await handleRestoreTrack.execute({
                type: 'restoreTrack',
                payload: { ...payload, trackKind: 'bus' },
            });

            await result?.afterCommit?.();

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.ensureBusStrip).not.toHaveBeenCalled();
            expect(mocks.setBusGain).not.toHaveBeenCalled();
        });

        const foreignRows = [{ id: 'foreign-row' }];
        it.each([
            [
                "MIDI notes for another track's clip",
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    midiNotesByClipId: { ...payload.midiNotesByClipId, [survivorClipId]: foreignRows },
                }),
            ],
            [
                "MIDI CC for another track's clip",
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    midiCcByClipId: { ...payload.midiCcByClipId, [survivorClipId]: foreignRows },
                }),
            ],
            [
                "MIDI pitch bend for another track's clip",
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    midiPitchBendByClipId: { ...payload.midiPitchBendByClipId, [survivorClipId]: foreignRows },
                }),
            ],
            [
                "a satellite of another track's clip",
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    clipSatellites: [
                        ...payload.clipSatellites,
                        {
                            clipId: survivorClipId,
                            gainEnvelope: { clipId: survivorClipId, points: [], enabled: true },
                            warpState: null,
                        },
                    ],
                }),
            ],
            [
                'an automation lane of another track',
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    automationLaneSnapshots: [
                        ...payload.automationLaneSnapshots,
                        { id: 'lane-survivor', trackId: survivor.id },
                    ],
                }),
            ],
            [
                // `survivor` holds `survivorClipId` live after the removal.
                'a clip automation lane on a clip a surviving track holds',
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    automationLaneSnapshots: [
                        ...payload.automationLaneSnapshots,
                        clipLane('lane-foreign-clip', survivorClipId),
                    ],
                }),
            ],
            [
                'a kind its row does not have',
                (payload: RestoreTrackPayload) => ({ ...payload, trackKind: 'bus' as const }),
            ],
            [
                'a parent its row does not have',
                (payload: RestoreTrackPayload) => ({ ...payload, trackParentId: survivor.id }),
            ],
            [
                'no parent while its row has one',
                (payload: RestoreTrackPayload) => ({
                    ...payload,
                    trackSnapshot: { ...payload.trackSnapshot, parentId: survivor.id },
                    trackParentId: null,
                }),
            ],
        ])('refuses before any write when the payload carries %s', (_label, corrupt) => {
            const payload = captureWithMembers(rowWithAlternativeOnlyClip());

            expectNothingWritten({ type: 'restoreTrack', payload: corrupt(payload) });
            expect(mocks.ensureBusStrip).not.toHaveBeenCalled();
        });
    });
});
