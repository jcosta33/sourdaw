import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';

const runtimeMocks = vi.hoisted(() => ({
    addDeviceToStrip: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    applyRuntimeGraphDelta: runtimeMocks.applyRuntimeGraphDelta,
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

describe('compound bus AppAction batch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
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

    it('creates and targets one stable bus identity inside a compensable atomic batch', async () => {
        const actions = [
            { type: 'createBus', payload: { name: 'Vocal Plate', busId: BUS_ID } },
            { type: 'addDevice', payload: { trackId: BUS_ID, deviceType: 'builtin-reverb' } },
            {
                type: 'addSend',
                payload: {
                    trackId: 'track-vocals',
                    busId: BUS_ID,
                    level: 0.25,
                    expectedAbsent: true,
                },
            },
        ] satisfies AppAction[];

        const result = await executeAppActionBatch(actions, {
            source: 'prompt',
            groupId: 'compound-bus',
            groupLabel: 'Create Vocal Plate routing',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        const state = trackStore.value;
        const bus = state?.tracks.find((track) => track.id === BUS_ID);
        const vocals = state?.tracks.find((track) => track.id === 'track-vocals');
        expect(bus?.kind).toBe('bus');
        expect(bus?.devices).toHaveLength(1);
        expect(bus?.devices[0]?.id).toMatch(/^device-/u);
        expect(bus?.devices[0]?.type).toBe('builtin-reverb');
        expect(vocals?.sends).toEqual([{ busId: BUS_ID, level: 0.25, preFader: false }]);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'replace-track-device-chain',
                operation: 'add-device',
                after: expect.objectContaining({ id: BUS_ID }),
            })
        );
        expect(runtimeMocks.engineSetSend).toHaveBeenCalledWith('track-vocals', BUS_ID, 0.25, false);
    });
});
