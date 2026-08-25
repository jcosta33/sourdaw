import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';
import { runtimeGraphTopology } from '../../useCases/runtimeGraphTopology';

const runtimeMocks = vi.hoisted(() => ({
    addDeviceToStrip: vi.fn(),
    clearReportedLatency: vi.fn(),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    removeDeviceFromStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    clearReportedLatency: runtimeMocks.clearReportedLatency,
    removeDeviceFromStrip: runtimeMocks.removeDeviceFromStrip,
    removeTrackStrip: runtimeMocks.removeTrackStrip,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    removeSend: runtimeMocks.engineRemoveSend,
    setSend: runtimeMocks.engineSetSend,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

const BUS_ID = 'bus-ai-00000000-0000-4000-8000-000000000001';

function createBusRoutingActions(): AppAction[] {
    return [
        { type: 'createBus', payload: { name: 'Vocal Plate', busId: BUS_ID } },
        { type: 'addDevice', payload: { trackId: BUS_ID, deviceType: 'builtin-reverb' } },
        {
            type: 'addSend',
            payload: { trackId: 'track-vocals', busId: BUS_ID, level: 0.25, expectedAbsent: true },
        },
    ] satisfies AppAction[];
}

/**
 * Grouped undo drives runtime-graph reconciliation with the project-owned
 * validators the composition root installs, so a delta compiled by one
 * sub-action is checked against the state the *whole* inverse batch committed.
 * Wiring them here is what makes this spec exercise the real configuration
 * instead of the permanently-rejecting unconfigured engine.
 */
describe('grouped undo runtime graph reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setArrangementEventBus(new NoopArrangementEventBus());
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const vocals = createTrack({ id: 'track-vocals', name: 'Vocals', kind: 'audio' });
        trackStore.set({ tracks: [vocals], selectedTrackId: vocals.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undoes a bus-and-device group without demanding manual runtime repair', async () => {
        await executeAppActionBatch(createBusRoutingActions(), {
            source: 'prompt',
            groupId: 'compound-bus',
            groupLabel: 'Create Vocal Plate routing',
            requireCompensation: true,
        });
        expect(trackStore.value?.tracks.find((track) => track.id === BUS_ID)?.devices).toHaveLength(1);

        // The inverse batch removes the send, then the device, then discards the
        // bus. The device removal's runtime delta is finalized after that whole
        // batch commits, by which point the bus is gone from project truth — the
        // delta is void, and demanding manual repair for it wedges undo.
        await expect(undo()).resolves.toBeUndefined();

        expect(trackStore.value?.tracks.some((track) => track.id === BUS_ID)).toBe(false);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.sends).toEqual([]);
        // The strip the void delta would have patched is torn down by the action
        // that actually removed the track, so nothing is left orphaned.
        expect(runtimeMocks.removeTrackStrip).toHaveBeenCalledWith(BUS_ID);
    });

    it('keeps the whole group atomic across that undo', async () => {
        await executeAppActionBatch(createBusRoutingActions(), {
            source: 'prompt',
            groupId: 'compound-bus',
            groupLabel: 'Create Vocal Plate routing',
            requireCompensation: true,
        });

        await undo();

        // All of it reverted or none of it: the bus, its device, and the send on
        // Vocals are one undo unit, so no fragment of the group may survive.
        const tracks = trackStore.value?.tracks ?? [];
        expect(tracks.map((track) => track.id)).toEqual(['track-vocals']);
        expect(tracks[0]?.sends).toEqual([]);
        expect(tracks[0]?.devices).toEqual([]);
    });
});
