import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { activateExternalPlugin, clearLoadedExternalPlugins } from '#/modules/PluginHost/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track, trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring a track drives the live engine strip, which jsdom's stubbed AudioContext cannot build.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    createTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

// The native host is doubled at the desktop IPC boundary, so every plugin-host use case between the
// removal's unload and Undo's reactivation is real. Its live state ("live") differs from the project
// chunk ("saved"), so the bytes the reactivation restores say which one survived.
const LIVE_BYTES = new Uint8Array([108, 105, 118, 101]);
const SAVED_CHUNK = 'c2F2ZWQ=';
type UnloadReply = { unloadedInstanceIds: string[]; errors: string[]; reports: unknown[] };
const native = vi.hoisted(() => ({
    loaded: new Set<string>(),
    heldUnload: null as PromiseWithResolvers<void> | null,
    unloadRequests: [] as string[],
    restoredBytes: new Map<string, Uint8Array>(),
}));

async function nativeUnload(instanceId: string): Promise<UnloadReply> {
    native.unloadRequests.push(instanceId);
    await native.heldUnload?.promise;
    native.loaded.delete(instanceId);
    return { unloadedInstanceIds: [instanceId], errors: [], reports: [] };
}

vi.mock('#/utils/desktopBridge', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isDesktopRuntime: () => true,
    desktopListen: () => Promise.resolve(() => {}),
    desktopInvoke: (command: string, args?: Record<string, unknown>) => {
        const instanceId = String(args?.instanceId);
        if (command === 'load_plugin') {
            native.loaded.add(instanceId);
            return Promise.resolve({
                instance_id: instanceId,
                plugin_id: String(args?.pluginId),
                name: 'Plugin',
                parameters: [],
                is_active: true,
                latency_samples: 0,
                latency_ms: 0,
                tail_samples: 0,
                engine_plugin_id: 1,
            });
        }
        if (command === 'unload_plugin') {
            return nativeUnload(instanceId);
        }
        return Promise.resolve(undefined);
    },
    invokeForBinaryResponse: () => Promise.resolve(LIVE_BYTES),
    invokeWithBinaryBody: ({ bytes, positionalMeta }: { bytes: Uint8Array; positionalMeta: readonly string[] }) => {
        native.restoredBytes.set(String(positionalMeta[0]), bytes);
        return Promise.resolve(undefined);
    },
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const INSTANCE_IDS = ['track-1-instance-1', 'track-1-instance-2'];

function hostedTrack(): Track {
    return TrackDummy.create({
        id: 'track-1',
        name: 'Keys',
        kind: 'audio',
        devices: INSTANCE_IDS.map((instanceId, slot) => ({
            id: `track-1-plugin-${String(slot)}`,
            name: `Plugin ${String(slot)}`,
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: `plugin-${String(slot)}`,
            externalInstanceId: instanceId,
            externalStateChunk: SAVED_CHUNK,
        })),
    });
}

// Issue #6557: an Undo that lands while the removal is still unloading the track's plugins found
// each instance still loaded, answered it active, and the unload then released it.
describe('undoing a track removal while its plugins are still unloading', () => {
    beforeEach(async () => {
        native.loaded.clear();
        native.restoredBytes.clear();
        native.heldUnload = null;
        native.unloadRequests = [];
        clearLoadedExternalPlugins();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('undo during unload integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setArrangementEventBus(new NoopArrangementEventBus());
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [hostedTrack()], selectedTrackId: 'track-1', ghostClips: [] });
        for (const [slot, instanceId] of INSTANCE_IDS.entries()) {
            await activateExternalPlugin({
                pluginId: `plugin-${String(slot)}`,
                instanceId,
                stateChunk: SAVED_CHUNK,
            });
        }
        native.restoredBytes.clear();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearLoadedExternalPlugins();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('reloads every instance with its live state once the held unload completes', async () => {
        native.heldUnload = Promise.withResolvers<void>();
        const removal = executeAppAction(
            { type: 'removeTrack', payload: { trackId: 'track-1' } },
            { source: 'manual' }
        );
        // The Undo must land after the native host has been asked to unload, or the removal's
        // absence check would simply skip the unload.
        await vi.waitFor(() => expect(native.unloadRequests).toContain(INSTANCE_IDS[0]));

        await undo();
        native.heldUnload.resolve();
        await removal;

        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['track-1']);
        await vi.waitFor(() => expect([...native.loaded].sort()).toEqual(INSTANCE_IDS));
        await vi.waitFor(() =>
            expect([...native.restoredBytes.entries()].sort()).toEqual(
                INSTANCE_IDS.map((instanceId) => [instanceId, LIVE_BYTES])
            )
        );
    });

    it('leaves no instance loaded when a Redo removes the track again before the held unload completes', async () => {
        native.heldUnload = Promise.withResolvers<void>();
        const removal = executeAppAction(
            { type: 'removeTrack', payload: { trackId: 'track-1' } },
            { source: 'manual' }
        );
        await vi.waitFor(() => expect(native.unloadRequests).toContain(INSTANCE_IDS[0]));
        await undo();

        const repeatedRemoval = redo();
        await vi.waitFor(() => expect(trackStore.value?.tracks).toEqual([]));
        native.heldUnload.resolve();
        await Promise.all([removal, repeatedRemoval]);

        expect(trackStore.value?.tracks).toEqual([]);
        expect([...native.loaded]).toEqual([]);
    });
});
