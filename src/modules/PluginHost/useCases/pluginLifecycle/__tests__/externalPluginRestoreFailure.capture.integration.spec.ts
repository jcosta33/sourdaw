import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    agentProjectInspectionPort,
    createCrdtDoc,
    hasCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { exportProjectFile, saveProject } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { bytesToBase64 } from '#/utils/base64';

import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { hasUnresolvedExternalPluginRestoreFailure } from '../hasUnresolvedExternalPluginRestoreFailure';

// The native plugin bridge is the controlled boundary: real activation, real
// capture, real command dispatch, and the real save/export persistence stack
// run above it. Every other mock is a contract barrel partially overridden via
// importOriginal, so the real module graphs stay loaded.
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string, sampleRate: number) => Promise<unknown>>(),
    setPluginStateRepo: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    getPluginStateRepo: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginStateRepo }));
vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginStateRepo }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ensureCachedAudioBuffersDurable: vi.fn(() =>
        Promise.resolve({ status: 'durable' as const, isCurrent: () => true, release: vi.fn() })
    ),
    exportCachedAudioBuffers: vi.fn(() => Promise.resolve({})),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: vi.fn(() => []),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const CREATED_AT = 1_700_000_000_000;
// The stable named-snapshot key format: `sourdaw:project:<createdAt>`.
const RECENT_KEY = 'sourdaw:project:1700000000000';
const TRACK_ID = 'track-3693';
const DEVICE_ID = 'dev-3693';
const ENGINE_SAMPLE_RATE = 44_100;

const bytesOf = (value: string): Uint8Array => new TextEncoder().encode(value);
const ORIGINAL_CHUNK = bytesToBase64(bytesOf('original-saved-state'));
const ACCEPTED_CHUNK = bytesToBase64(bytesOf('accepted-runtime-state'));
const REPLACED_CHUNK = bytesToBase64(bytesOf('deliberately-replaced'));
const FRESH_CHUNK = bytesToBase64(bytesOf('fresh-host-state'));
const FRESH_EDIT_CHUNK = bytesToBase64(bytesOf('fresh-host-state-edited'));

/**
 * Minimal in-memory IndexedDB double covering the surface the project snapshot
 * writer uses: open, readwrite transaction, objectStore.put. Installed once and
 * shared across the file, because the project storage module holds its database
 * handle for the whole worker; each test deletes the key it will assert on.
 */
const indexedDbValues = (() => {
    const backing = new Map<string, string>();

    function makeRequest<T>(run: () => T) {
        const request: {
            result: T | undefined;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
        } = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            try {
                request.result = run();
                request.onsuccess?.();
            } catch (error) {
                request.error = error;
                request.onerror?.();
            }
        });
        return request;
    }

    const objectStore = {
        get: (key: string) => makeRequest(() => (backing.has(key) ? backing.get(key) : null)),
        put: (value: string, key: string) =>
            makeRequest(() => {
                backing.set(key, value);
                return undefined;
            }),
    };

    function makeTransaction() {
        const transaction: {
            error: unknown;
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
            objectStore: () => typeof objectStore;
        } = { error: null, oncomplete: null, onerror: null, objectStore: () => objectStore };
        queueMicrotask(() => transaction.oncomplete?.());
        return transaction;
    }

    const database = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => objectStore,
        transaction: () => makeTransaction(),
        close: () => undefined,
    };
    vi.stubGlobal('indexedDB', {
        open: () => {
            const request: {
                result: typeof database;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    });
    return backing;
})();

const initialArrangementState = structuredClone(arrangementStore.value);

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type PersistedSnapshot = {
    arrangement?: { tracks?: { devices?: { externalStateChunk?: string }[] }[] };
};

function persistedDeviceChunk(): string | undefined {
    const json = indexedDbValues.get(RECENT_KEY);
    if (json === undefined) {
        throw new Error('Expected the save to persist a named snapshot');
    }
    const snapshot = JSON.parse(json) as PersistedSnapshot;
    return snapshot.arrangement?.tracks?.[0]?.devices?.[0]?.externalStateChunk;
}

function storedDeviceChunk(deviceIndex = 0): string | undefined {
    const device = trackStore.value?.tracks[0]?.devices[deviceIndex];
    if (!device) {
        throw new Error(`Expected the device at index ${deviceIndex} in the track store`);
    }
    return device.externalStateChunk;
}

function seedSavedProject(instanceId: string, stateChunk: string | undefined): void {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        createdAt: CREATED_AT,
        dirty: true,
        loading: false,
        name: 'Restore Failure',
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        updatedAt: CREATED_AT,
    });
    trackStore.set({
        tracks: [
            normalizeTrack({
                id: TRACK_ID,
                name: 'Led',
                kind: 'audio',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Serum',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalPluginId: 'serum',
                        externalInstanceId: instanceId,
                        externalStateChunk: stateChunk,
                    },
                ],
            }),
        ],
        selectedTrackId: TRACK_ID,
    });
}

function activateInstance(instanceId: string, stateChunk: string | undefined) {
    return activateExternalPlugin({
        pluginId: 'serum',
        instanceId,
        stateChunk,
        engineSampleRate: ENGINE_SAMPLE_RATE,
    });
}

describe('external plugin state survives a failed restore (issue 3693)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('external plugin restore failure persistence');
        if (hasCrdtDoc('root')) {
            removeCrdtDoc('root');
        }
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearLoadedExternalPlugins();
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...defaultTransportState });
        arrangementStore.set(structuredClone(initialArrangementState));
        indexedDbValues.delete(RECENT_KEY);
        mocks.loadPluginRepo.mockResolvedValue({
            instance_id: 'instance-from-host',
            plugin_id: 'serum',
            name: 'Serum',
            parameters: [],
            is_active: true,
            latency_samples: 0,
            latency_ms: 0,
            tail_samples: 0,
            engine_plugin_id: 1000,
        });
        mocks.setPluginStateRepo.mockResolvedValue(undefined);
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('plugin-defaults'));
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        agentProjectInspectionPort.setProvider(() => ({
            audioGraphValid: true,
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
    });

    afterEach(() => {
        agentProjectInspectionPort.setProvider(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearLoadedExternalPlugins();
        trackStore.set({ tracks: [], selectedTrackId: null });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        if (hasCrdtDoc('root')) {
            removeCrdtDoc('root');
        }
        configureAutomergeStoragePort(null);
        Container.clear();
    });

    it('keeps the original saved chunk across Save and Export when the plugin rejected its state', async () => {
        const instanceId = 'inst-failed';
        seedSavedProject(instanceId, ORIGINAL_CHUNK);
        mocks.setPluginStateRepo.mockRejectedValue(new Error('state chunk rejected'));

        await expect(activateInstance(instanceId, ORIGINAL_CHUNK)).resolves.toEqual({
            status: 'failed',
            stage: 'restore',
            reason: 'Error: state chunk rejected',
        });
        expect(hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(true);

        await expect(saveProject()).resolves.toBe(true);

        // The plugin's default runtime state never reaches the snapshot: the
        // host is not even read, and the stored chunk keeps the original bytes.
        expect(mocks.getPluginStateRepo).not.toHaveBeenCalled();
        expect(persistedDeviceChunk()).toBe(ORIGINAL_CHUNK);

        await exportProjectFile();
        expect(storedDeviceChunk()).toBe(ORIGINAL_CHUNK);
    });

    it('captures fresh state after an explicit set-state replacement clears the marker', async () => {
        const instanceId = 'inst-replaced';
        seedSavedProject(instanceId, ORIGINAL_CHUNK);
        mocks.setPluginStateRepo.mockRejectedValue(new Error('state chunk rejected'));
        await activateInstance(instanceId, ORIGINAL_CHUNK);
        expect(hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(true);

        // Deliberate replacement through the real command path.
        await executeAppAction(
            { type: 'setExternalPluginState', payload: { deviceId: DEVICE_ID, stateChunk: REPLACED_CHUNK } },
            { skipMacroRecording: true }
        );
        expect(hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(false);

        // The plugin now holds fresh authoritative state; capture reads it again.
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('fresh-host-state'));
        await exportProjectFile();
        expect(storedDeviceChunk()).toBe(FRESH_CHUNK);

        // And subsequent edits capture normally.
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('fresh-host-state-edited'));
        await exportProjectFile();
        expect(storedDeviceChunk()).toBe(FRESH_EDIT_CHUNK);
    });

    it('captures the runtime state as before when the plugin accepts its restore', async () => {
        const instanceId = 'inst-healthy';
        seedSavedProject(instanceId, ORIGINAL_CHUNK);
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('accepted-runtime-state'));
        await expect(activateInstance(instanceId, ORIGINAL_CHUNK)).resolves.toEqual({ status: 'active' });
        expect(hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(false);

        await exportProjectFile();
        expect(storedDeviceChunk()).toBe(ACCEPTED_CHUNK);
        expect(mocks.getPluginStateRepo).toHaveBeenCalledTimes(1);
    });

    it('preserves capture behavior for a slot without an instance and for an absent stored chunk', async () => {
        const instanceId = 'inst-no-chunk';
        seedSavedProject(instanceId, undefined);
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('accepted-runtime-state'));
        await expect(activateInstance(instanceId, undefined)).resolves.toEqual({ status: 'active' });

        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: TRACK_ID,
                    name: 'Led',
                    kind: 'audio',
                    devices: [
                        {
                            id: DEVICE_ID,
                            name: 'Serum',
                            type: 'external-plugin',
                            bypassed: false,
                            parameterValues: {},
                            externalPluginId: 'serum',
                            externalInstanceId: instanceId,
                        },
                        {
                            id: 'dev-no-instance',
                            name: 'No Instance',
                            type: 'external-plugin',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
            ],
            selectedTrackId: TRACK_ID,
        });

        await exportProjectFile();

        expect(storedDeviceChunk()).toBe(ACCEPTED_CHUNK);
        expect(storedDeviceChunk(1)).toBeUndefined();
        expect(mocks.getPluginStateRepo).toHaveBeenCalledTimes(1);
    });
});
