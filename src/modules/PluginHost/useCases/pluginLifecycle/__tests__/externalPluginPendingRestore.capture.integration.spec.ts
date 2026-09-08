import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

const mocks = vi.hoisted(() => ({
    downloadBlob: vi.fn<(data: Blob | BlobPart, filename: string, mimeType?: string) => void>(),
    getPluginStateRepo: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string, sampleRate: number) => Promise<unknown>>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    readPluginStateForCaptureEntry: vi.fn<(instanceId: string) => void>(),
    setPluginStateRepo: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    unloadPluginRepo:
        vi.fn<
            (instanceId?: string) => Promise<{ unloadedInstanceIds: string[]; errors: string[]; reports: never[] }>
        >(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginStateRepo }));
vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginStateRepo }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPluginRepo }));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        readExternalPluginStateForCapture: (
            instanceId: string
        ): ReturnType<typeof actual.readExternalPluginStateForCapture> => {
            mocks.readPluginStateForCaptureEntry(instanceId);
            return actual.readExternalPluginStateForCapture(instanceId);
        },
    };
});

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
vi.mock('#/utils/downloadFile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/downloadFile')>()),
    downloadBlob: mocks.downloadBlob,
}));

const CREATED_AT = 1_700_003_693_000;
const RECENT_KEY = `sourdaw:project:${CREATED_AT}`;
const TRACK_ID = 'track-pending-restore';
const DEVICE_ID = 'device-pending-restore';
const SAVE_INSTANCE_ID = 'instance-pending-restore-save';
const EXPORT_INSTANCE_ID = 'instance-pending-restore-export';
const REVOKED_INSTANCE_ID = 'instance-final-native-revocation';
const ENGINE_SAMPLE_RATE = 44_100;
const RESTORE_ERROR = 'Error: state chunk rejected during retry';

const bytesOf = (value: string): Uint8Array => new TextEncoder().encode(value);

type PersistedSnapshot = {
    arrangement?: { tracks?: { name?: string; devices?: { externalStateChunk?: string }[] }[] };
};

type Deferred<Value> = {
    promise: Promise<Value>;
    reject: (reason?: unknown) => void;
    resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
    let deferredResolve!: (value: Value) => void;
    let deferredReject!: (reason?: unknown) => void;
    const promise = new Promise<Value>((resolve, reject) => {
        deferredResolve = resolve;
        deferredReject = reject;
    });
    return { promise, reject: deferredReject, resolve: deferredResolve };
}

function readIndexedDbValue(databaseName: string, storeName: string, key: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1);
        open.onerror = () => reject(open.error ?? new Error(`Could not open ${databaseName}`));
        open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).get(key);
            let value: string | undefined;
            request.onsuccess = () => {
                value = request.result as string | undefined;
            };
            transaction.onerror = () => reject(transaction.error ?? new Error(`Could not read ${key}`));
            transaction.onabort = () => reject(transaction.error ?? new Error(`Read of ${key} aborted`));
            transaction.oncomplete = () => {
                database.close();
                resolve(value);
            };
        };
    });
}

async function loadContracts() {
    const [
        { Container },
        automergeStorage,
        arrangementStores,
        arrangementUseCases,
        commandStores,
        commandUseCases,
        crdtUseCases,
        midiStores,
        projectStores,
        projectUseCases,
        transportStores,
        pluginHostStores,
        base64,
        activation,
        lifecycleReset,
        restoreFailure,
        unloading,
    ] = await Promise.all([
        import('#/infra/di/Container'),
        import('#/infra/store/storage/createAutomergeStorage'),
        import('#/modules/Arrangement/stores'),
        import('#/modules/Arrangement/useCases'),
        import('#/modules/Command/stores'),
        import('#/modules/Command/useCases'),
        import('#/modules/CrdtDocument/useCases'),
        import('#/modules/MIDI/stores'),
        import('#/modules/Project/stores'),
        import('#/modules/Project/useCases'),
        import('#/modules/Transport/stores'),
        import('#/modules/PluginHost/stores'),
        import('#/utils/base64'),
        import('../activateExternalPlugin'),
        import('../clearLoadedExternalPlugins'),
        import('../hasUnresolvedExternalPluginRestoreFailure'),
        import('../unloadPlugin'),
    ]);
    return {
        Container,
        ...automergeStorage,
        ...arrangementStores,
        ...arrangementUseCases,
        ...commandStores,
        ...commandUseCases,
        ...crdtUseCases,
        ...midiStores,
        ...projectStores,
        ...projectUseCases,
        ...transportStores,
        ...pluginHostStores,
        ...base64,
        ...activation,
        ...lifecycleReset,
        ...restoreFailure,
        ...unloading,
    };
}

let indexedDb: TransactionalIndexedDbInstallation;
let contracts: Awaited<ReturnType<typeof loadContracts>>;
let initialArrangementState: typeof contracts.arrangementStore.value;
let lockManager: ReturnType<typeof createControlledLockManager>;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function seedSavedProject(instanceId: string, stateChunk: string): void {
    contracts.projectStore.set({
        ...structuredClone(contracts.defaultProjectStoreState),
        createdAt: CREATED_AT,
        dirty: true,
        loading: false,
        name: 'Pending Restore',
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaa3693',
        updatedAt: CREATED_AT,
    });
    contracts.trackStore.set({
        tracks: [
            contracts.normalizeTrack({
                id: TRACK_ID,
                name: 'Lead',
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
    contracts.flushAutomergeStorageWrites();
}

function activateInstance(instanceId: string, stateChunk: string): Promise<unknown> {
    return contracts.activateExternalPlugin({
        pluginId: 'serum',
        instanceId,
        stateChunk,
        engineSampleRate: ENGINE_SAMPLE_RATE,
    });
}

async function beginPendingRetry(
    instanceId: string,
    originalChunk: string
): Promise<{
    activation: Promise<unknown>;
    restore: Deferred<void>;
}> {
    mocks.loadPluginRepo.mockRejectedValueOnce(new Error('transient load failure'));
    await expect(activateInstance(instanceId, originalChunk)).resolves.toEqual({
        status: 'failed',
        stage: 'load',
        reason: 'Error: transient load failure',
    });
    expect(contracts.hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(false);

    const restore = deferred<void>();
    mocks.setPluginStateRepo.mockImplementationOnce(() => restore.promise);
    const activation = activateInstance(instanceId, originalChunk);
    await vi.waitFor(() => expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1));
    expect(mocks.readPluginStateForCaptureEntry).not.toHaveBeenCalled();
    return { activation, restore };
}

async function settleRejectedRestore(activation: Promise<unknown>, restore: Deferred<void>): Promise<void> {
    restore.reject(new Error('state chunk rejected during retry'));
    await expect(activation).resolves.toEqual({
        status: 'failed',
        stage: 'restore',
        reason: RESTORE_ERROR,
    });
}

function expectRestoreErrorPreserved(instanceId: string): void {
    expect(contracts.externalPluginActivationStore.value?.byInstanceId[instanceId]).toEqual({
        status: 'error',
        message: RESTORE_ERROR,
    });
}

function expectNoAutomaticReplacement(instanceId: string): void {
    expect(contracts.hasUnresolvedExternalPluginRestoreFailure(instanceId)).toBe(true);
    expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1);
}

function serializedDeviceChunk(snapshot: PersistedSnapshot): string | undefined {
    return snapshot.arrangement?.tracks?.[0]?.devices?.[0]?.externalStateChunk;
}

describe('external plugin capture while saved-state restore is pending (issue 3693)', () => {
    beforeAll(async () => {
        indexedDb = installTransactionalIndexedDb();
        contracts = await loadContracts();
        initialArrangementState = structuredClone(contracts.arrangementStore.value);
    }, 20_000);

    beforeEach(() => {
        vi.clearAllMocks();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        localStorage.clear();
        Reflect.deleteProperty(window, 'showSaveFilePicker');
        Reflect.deleteProperty(window, 'sourdaw');
        contracts.Container.clear();
        contracts.configureAutomergeStoragePort(null);
        contracts.resetCrdtProjectAuthority('external plugin pending restore capture baseline');
        if (contracts.hasCrdtDoc('root')) {
            contracts.removeCrdtDoc('root');
        }
        contracts.createCrdtDoc('root');
        contracts.registerCrdtStorageRuntime();
        contracts.clearHandlerRegistry();
        contracts.registerHandlerMap(contracts.getArrangementHandlers());
        contracts.clearUndoHistory();
        contracts.resetActionReplayAuthority();
        contracts.setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        contracts.macroStore.set({ macros: [], recording: false, currentRecording: [] });
        contracts.clearLoadedExternalPlugins();
        contracts.midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        contracts.transportStore.set({ ...contracts.defaultTransportState });
        contracts.arrangementStore.set(structuredClone(initialArrangementState));
        contracts.projectLoadFailureStore.set(null);
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) =>
            Promise.resolve({
                instance_id: instanceId,
                plugin_id: 'serum',
                name: 'Serum',
                parameters: [],
                is_active: true,
                latency_samples: 0,
                latency_ms: 0,
                tail_samples: 0,
                engine_plugin_id: 1000,
            })
        );
        mocks.setPluginStateRepo.mockResolvedValue(undefined);
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('plugin-defaults-after-rejection'));
        mocks.unloadPluginRepo.mockResolvedValue({ unloadedInstanceIds: [], errors: [], reports: [] });
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        contracts.agentProjectInspectionPort.setProvider(() => ({
            audioGraphValid: true,
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
    });

    afterEach(async () => {
        await lockManager.locks.request('sourdaw:project-audio-storage', { mode: 'exclusive' }, async () => undefined);
        contracts.agentProjectInspectionPort.setProvider(null);
        contracts.clearUndoHistory();
        contracts.resetActionReplayAuthority();
        contracts.clearHandlerRegistry();
        contracts.clearLoadedExternalPlugins();
        contracts.trackStore.set({ tracks: [], selectedTrackId: null });
        contracts.midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        if (contracts.hasCrdtDoc('root')) {
            contracts.removeCrdtDoc('root');
        }
        contracts.configureAutomergeStoragePort(null);
        contracts.Container.clear();
        vi.unstubAllGlobals();
    });

    afterAll(async () => {
        await indexedDb.dispose();
    }, 20_000);

    it('preserves original bytes in the real named snapshot when Save enters capture before restore rejects', async () => {
        const originalChunk = contracts.bytesToBase64(bytesOf('original-save-state'));
        seedSavedProject(SAVE_INSTANCE_ID, originalChunk);
        const { activation, restore } = await beginPendingRetry(SAVE_INSTANCE_ID, originalChunk);

        const saving = contracts.saveProject();
        await vi.waitFor(() => expect(mocks.readPluginStateForCaptureEntry).toHaveBeenCalledWith(SAVE_INSTANCE_ID));
        expect(mocks.getPluginStateRepo).not.toHaveBeenCalled();

        await settleRejectedRestore(activation, restore);
        await expect(saving).resolves.toBe(true);
        expect(mocks.getPluginStateRepo).not.toHaveBeenCalled();
        expectRestoreErrorPreserved(SAVE_INSTANCE_ID);

        const json = await readIndexedDbValue('sourdaw-projects', 'projects', RECENT_KEY);
        if (json === undefined) {
            throw new Error('Expected Save to commit the named project snapshot');
        }
        const persisted = JSON.parse(json) as PersistedSnapshot;
        const chunk = serializedDeviceChunk(persisted);
        expect(chunk).toBe(originalChunk);
        expectNoAutomaticReplacement(SAVE_INSTANCE_ID);
    }, 20_000);

    it('preserves original bytes in the real exported Blob when Export enters capture before restore rejects', async () => {
        const originalChunk = contracts.bytesToBase64(bytesOf('original-export-state'));
        seedSavedProject(EXPORT_INSTANCE_ID, originalChunk);
        const { activation, restore } = await beginPendingRetry(EXPORT_INSTANCE_ID, originalChunk);

        const exporting = contracts.exportProjectFile();
        await vi.waitFor(() => expect(mocks.readPluginStateForCaptureEntry).toHaveBeenCalledWith(EXPORT_INSTANCE_ID));
        expect(mocks.getPluginStateRepo).not.toHaveBeenCalled();

        await settleRejectedRestore(activation, restore);
        await exporting;
        expect(mocks.getPluginStateRepo).not.toHaveBeenCalled();
        expectRestoreErrorPreserved(EXPORT_INSTANCE_ID);
        expect(mocks.downloadBlob).toHaveBeenCalledOnce();

        const blob = mocks.downloadBlob.mock.calls[0]?.[0];
        if (!(blob instanceof Blob)) {
            throw new TypeError('Expected the real browser export serializer to produce a Blob');
        }
        const exported = JSON.parse(await blob.text()) as PersistedSnapshot;
        const chunk = serializedDeviceChunk(exported);
        expect(chunk).toBe(originalChunk);
        expectNoAutomaticReplacement(EXPORT_INSTANCE_ID);
    }, 20_000);

    it('rolls back capture when native authority is revoked after the handler writes, then retries', async () => {
        const originalChunk = contracts.bytesToBase64(bytesOf('original-revocation-state'));
        const freshChunk = contracts.bytesToBase64(bytesOf('fresh-native-state'));
        const unrelatedTrackName = 'Lead with preserved edit';
        seedSavedProject(REVOKED_INSTANCE_ID, originalChunk);
        const openingState = contracts.trackStore.value;
        if (!openingState) {
            throw new Error('Expected a live track store');
        }
        contracts.trackStore.set({
            ...openingState,
            tracks: openingState.tracks.map((track) =>
                track.id === TRACK_ID ? { ...track, name: unrelatedTrackName } : track
            ),
        });
        contracts.flushAutomergeStorageWrites();

        await expect(activateInstance(REVOKED_INSTANCE_ID, originalChunk)).resolves.toEqual({ status: 'active' });
        mocks.getPluginStateRepo.mockResolvedValue(bytesOf('fresh-native-state'));
        mocks.unloadPluginRepo.mockResolvedValueOnce({
            unloadedInstanceIds: [REVOKED_INSTANCE_ID],
            errors: [],
            reports: [],
        });

        const observedChunks: (string | undefined)[] = [];
        const lifecycle = { unloading: null as Promise<void> | null };
        const unsubscribe = contracts.trackStore.subscribe(() => {
            const chunk = contracts.trackStore.value?.tracks[0]?.devices[0]?.externalStateChunk;
            observedChunks.push(chunk);
            if (chunk === freshChunk && !lifecycle.unloading) {
                lifecycle.unloading = contracts.unloadPlugin(REVOKED_INSTANCE_ID);
            }
        });
        let firstSave: boolean;
        try {
            firstSave = await contracts.saveProject();
        } finally {
            unsubscribe();
        }
        if (!lifecycle.unloading) {
            throw new Error('Expected the pending capture write to revoke native authority');
        }
        await lifecycle.unloading;

        expect(firstSave).toBe(true);
        expect(observedChunks).toContain(freshChunk);
        expect(observedChunks.at(-1)).toBe(originalChunk);
        expect(contracts.trackStore.value?.tracks[0]?.devices[0]?.externalStateChunk).toBe(originalChunk);
        expect(contracts.trackStore.value?.tracks[0]?.name).toBe(unrelatedTrackName);
        expect(contracts.projectStore.value?.dirty).toBe(true);

        const rejectedDocument = contracts.getCrdtDoc<{
            tracks?: { tracks?: { name?: string; devices?: { externalStateChunk?: string }[] }[] };
        }>('root');
        expect(rejectedDocument?.tracks?.tracks?.[0]?.devices?.[0]?.externalStateChunk).toBe(originalChunk);
        expect(rejectedDocument?.tracks?.tracks?.[0]?.name).toBe(unrelatedTrackName);

        const rejectedJson = await readIndexedDbValue('sourdaw-projects', 'projects', RECENT_KEY);
        if (rejectedJson === undefined) {
            throw new Error('Expected Save to commit the named project snapshot');
        }
        const rejectedSnapshot = JSON.parse(rejectedJson) as PersistedSnapshot;
        expect(serializedDeviceChunk(rejectedSnapshot)).toBe(originalChunk);
        expect(rejectedSnapshot.arrangement?.tracks?.[0]?.name).toBe(unrelatedTrackName);
        expect(mocks.unloadPluginRepo).toHaveBeenCalledExactlyOnceWith(REVOKED_INSTANCE_ID);
        expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1);

        await expect(activateInstance(REVOKED_INSTANCE_ID, originalChunk)).resolves.toEqual({ status: 'active' });
        await expect(contracts.saveProject()).resolves.toBe(true);

        expect(contracts.trackStore.value?.tracks[0]?.devices[0]?.externalStateChunk).toBe(freshChunk);
        expect(contracts.trackStore.value?.tracks[0]?.name).toBe(unrelatedTrackName);
        expect(contracts.projectStore.value?.dirty).toBe(false);
        const retriedDocument = contracts.getCrdtDoc<{
            tracks?: { tracks?: { name?: string; devices?: { externalStateChunk?: string }[] }[] };
        }>('root');
        expect(retriedDocument?.tracks?.tracks?.[0]?.devices?.[0]?.externalStateChunk).toBe(freshChunk);
        expect(retriedDocument?.tracks?.tracks?.[0]?.name).toBe(unrelatedTrackName);

        const retriedJson = await readIndexedDbValue('sourdaw-projects', 'projects', RECENT_KEY);
        if (retriedJson === undefined) {
            throw new Error('Expected retry to update the named project snapshot');
        }
        const retriedSnapshot = JSON.parse(retriedJson) as PersistedSnapshot;
        expect(serializedDeviceChunk(retriedSnapshot)).toBe(freshChunk);
        expect(retriedSnapshot.arrangement?.tracks?.[0]?.name).toBe(unrelatedTrackName);
        expect(mocks.getPluginStateRepo).toHaveBeenCalledTimes(2);
        expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(2);
    }, 20_000);
});
