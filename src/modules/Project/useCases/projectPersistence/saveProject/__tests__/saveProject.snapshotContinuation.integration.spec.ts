import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    installNativePreparationWorker,
    settleNativePreparationWorkers,
} from '#/helpers/__tests__/nativePreparationWorker';
import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { installMultiDatabaseIndexedDb } from './multiDatabaseIndexedDb';

import type { ProjectData } from '../../../../models/ProjectData';

const CREATED_AT = 1_700_000_000_000;
const CASE_TIMEOUT_MS = 30_000;
const REFUSAL_PREFIX = '[saveProject] Project or audio changed during snapshot persistence';

type IndexedDbFixture = ReturnType<typeof installMultiDatabaseIndexedDb>;

function createAudioBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
        copyFromChannel: (destination: Float32Array, channel: number, startInChannel = 0) => {
            destination.set(channels[channel]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source: Float32Array, channel: number, startInChannel = 0) => {
            channels[channel]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channel: number) => channels[channel]!,
        length,
        numberOfChannels,
        sampleRate,
    };
}

function stereoBuffer(left: readonly number[], right: readonly number[]): AudioBuffer {
    const buffer = createAudioBuffer(2, left.length, 48_000);
    buffer.copyToChannel(new Float32Array(left), 0);
    buffer.copyToChannel(new Float32Array(right), 1);
    return buffer;
}

let lockManager: ControlledLockManager;

/** A fresh module graph per case: the save queue and every store are module state. */
async function openProjectWithCachedStereoClip() {
    const [
        { audioEngine, cacheAudioBuffer, configureDurableAudioBufferOwnership, restoreCachedAudioBuffersFromIdb },
        { audioBufferCache },
        { addClip, addTrack, getArrangementHandlers, renameTrack, setArrangementEventBus },
        project,
        { projectStore },
        { registerCrdtStorageRuntime, resetCrdtProjectAuthority },
        { resetModuleStoresToDefault },
        { createFreshProjectMetadata },
        { configureCollaborationAssetOwner },
        { withProjectAudioStorageLock },
        { registerHandlerMap },
        { logger },
        { injectDependencies },
        { notifyUser },
        { registerProjectLifecycle },
        { registerSupportingServicePorts },
    ] = await Promise.all([
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/AudioEngine/stores'),
        import('#/modules/Arrangement/useCases'),
        import('#/modules/Project/useCases'),
        import('#/modules/Project/stores'),
        import('#/modules/CrdtDocument/useCases'),
        import('../../helpers/resetModuleStoresToDefault'),
        import('../../../createFreshProjectMetadata'),
        import('#/modules/Collaboration/useCases'),
        import('#/infra/storage/withProjectAudioStorageLock'),
        import('#/modules/Command/stores'),
        import('#/infra/logger/appLogger'),
        import('#/infra/di/testing/injectDependencies'),
        import('#/utils/Notification/notifyUser'),
        import('#/app/registerProjectLifecycle'),
        import('#/app/registerSupportingServicePorts'),
    ]);
    injectDependencies(notifyUser, { eventBus: { emit: vi.fn(() => Promise.resolve()) } });
    const context = audioEngine.context as AudioContext & { createBuffer: typeof createAudioBuffer };
    context.createBuffer = createAudioBuffer;
    await restoreCachedAudioBuffersFromIdb({ audioContext: context });
    setArrangementEventBus({ emit: vi.fn(() => Promise.resolve()) });
    registerHandlerMap(getArrangementHandlers());
    const { getWorkspaceHandlers } = await import('#/modules/WorkspaceShell/useCases');
    registerHandlerMap({ saveProject: getWorkspaceHandlers().saveProject });
    registerCrdtStorageRuntime();
    configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
    configureDurableAudioBufferOwnership(project.collectDurableOwnedAudioBufferIds);
    project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    resetCrdtProjectAuthority('Continuation');
    registerProjectLifecycle();
    registerSupportingServicePorts();
    resetModuleStoresToDefault();
    projectStore.set({
        ...createFreshProjectMetadata({ name: 'Continuation', loading: false, initialized: true }),
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        dirty: true,
    });

    const track = addTrack({ name: 'Close Drums', kind: 'audio' });
    if (!track) {
        throw new Error('expected an audio track');
    }
    const bufferId = cacheAudioBuffer({ buffer: stereoBuffer([0.25, -0.25, 0.1], [0.12, -0.12, 0.05]) });
    const clip = addClip({
        trackId: track.id,
        name: 'Deterministic close drums',
        startBeat: 0,
        endBeat: 2,
        type: 'audio',
        audioBufferId: bufferId,
    });
    if (!clip) {
        throw new Error('expected an audio clip');
    }
    const warn = vi.spyOn(logger, 'warn');
    const persistenceFailures = (): string[] =>
        warn.mock.calls
            .filter(([message]) => message === '[saveProject] Project persistence failed:')
            .map(([, error]) => (error instanceof Error ? error.message : String(error)));
    return {
        audioBufferCache,
        bufferId,
        cacheAudioBuffer,
        persistenceFailures,
        project,
        projectStore,
        renameTrack,
        track,
        withProjectAudioStorageLock,
    };
}

type OpenedProject = Awaited<ReturnType<typeof openProjectWithCachedStereoClip>>;

/** Holds the project audio storage lock, so a save that starts now stops inside its preflight. */
async function startSaveHeldInPreflight(
    opened: OpenedProject
): Promise<{ release: () => void; saving: Promise<boolean> }> {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    void opened.withProjectAudioStorageLock(() => gate);
    const requestedBefore = lockManager.requestedNames.length;
    const saving = opened.project.saveProject();
    await vi.waitFor(() => expect(lockManager.requestedNames.length).toBeGreaterThan(requestedBefore));
    return { release, saving };
}

type ArrangementStore = typeof import('../../../../stores/arrangementStore').arrangementStore;

type SlowWorkerRequest = {
    signal: AbortSignal;
    /** Runs the callback in a later task, so a write is not part of the save's own action. */
    afterTask: (callback: () => void) => void;
};

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Worker request abandoned')), { once: true });
    });
}

/** Gives the first save preparation a Worker round trip, which these cases script. */
async function stubSlowMaterializationWorker(behaviour: (request: SlowWorkerRequest) => Promise<void>) {
    const arrangementStoreModule = await import('../../../../stores/arrangementStore');
    const prepare = arrangementStoreModule.prepareArrangementStoreState;
    const signals: AbortSignal[] = [];
    let materializeCalls = 0;
    vi.spyOn(arrangementStoreModule, 'prepareArrangementStoreState').mockImplementation((...args) => {
        const plan = prepare(...args);
        if (!plan || signals.length > 0) {
            return plan;
        }
        return {
            ...plan,
            requestMaterialization: (signal: AbortSignal) => {
                signals.push(signal);
                return behaviour({
                    signal,
                    afterTask: (callback) => {
                        setTimeout(callback, 0);
                    },
                });
            },
            materialize: () => {
                materializeCalls += 1;
                plan.materialize();
            },
        };
    });
    return { signals, materializeCalls: () => materializeCalls };
}

/** Counts the subscriptions the save's preparation still holds on the stores it captures. */
async function countStoreSubscriptions() {
    const [
        { trackStore, markerStore, takeLaneStore },
        { automationStore },
        { midiStore },
        transport,
        arrangement,
        projectStores,
    ] = await Promise.all([
        import('#/modules/Arrangement/stores'),
        import('#/modules/Automation/stores'),
        import('#/modules/MIDI/stores'),
        import('#/modules/Transport/stores'),
        import('../../../../stores/arrangementStore'),
        import('../../../../stores/projectStore'),
    ]);
    let active = 0;
    function countSubscriptions(store: { subscribe(callback: (value: unknown) => void): () => void }): void {
        const subscribe = store.subscribe.bind(store);
        vi.spyOn(store, 'subscribe').mockImplementation((callback) => {
            active += 1;
            const unsubscribe = subscribe(callback);
            let released = false;
            return () => {
                if (!released) {
                    released = true;
                    active -= 1;
                }
                unsubscribe();
            };
        });
    }
    countSubscriptions(trackStore);
    countSubscriptions(markerStore);
    countSubscriptions(takeLaneStore);
    countSubscriptions(automationStore);
    countSubscriptions(midiStore);
    countSubscriptions(transport.tempoMapStore);
    countSubscriptions(transport.timeSignatureMapStore);
    countSubscriptions(arrangement.arrangementStore);
    countSubscriptions(projectStores.projectStore);
    return { active: () => active };
}

const SERIAL_SNAPSHOT_WORK = ['capture', 'build', 'first save settled', 'capture', 'build'];

/** Records each save's plugin capture and snapshot build, in order, through the real implementations. */
async function traceSnapshotWork(): Promise<{ events: string[]; markSettled: (save: Promise<boolean>) => void }> {
    const [buildModule, captureModule] = await Promise.all([
        import('../../fileIO/buildProjectData'),
        import('../captureExternalPluginStates'),
    ]);
    const events: string[] = [];
    const buildProjectData = buildModule.buildProjectData;
    vi.spyOn(buildModule, 'buildProjectData').mockImplementation((...args) => {
        events.push('build');
        return buildProjectData(...args);
    });
    const captureExternalPluginStates = captureModule.captureExternalPluginStates;
    vi.spyOn(captureModule, 'captureExternalPluginStates').mockImplementation((...args) => {
        events.push('capture');
        return captureExternalPluginStates(...args);
    });
    return {
        events,
        markSettled: (save) => {
            void save.then(
                () => events.push('first save settled'),
                () => events.push('first save settled')
            );
        },
    };
}

/** Holds the named-project snapshot write, the last durable step after both durability receipts. */
async function startSaveHeldAtSnapshotWrite(
    opened: OpenedProject,
    indexedDb: IndexedDbFixture
): Promise<{ release: () => void; saving: Promise<boolean> }> {
    indexedDb.pauseNamedProjectWriteSettlements();
    const saving = opened.project.saveProject();
    await vi.waitFor(() => expect(indexedDb.pendingNamedProjectWriteSettlements()).toBe(1));
    return {
        release: () => {
            indexedDb.resumeNamedProjectWriteSettlements();
            indexedDb.releaseNextNamedProjectWriteSettlement();
        },
        saving,
    };
}

function savedTrackNames(indexedDb: IndexedDbFixture, opened: OpenedProject): string[] {
    const json = indexedDb.get('sourdaw-projects', 'projects', opened.project.getProjectSnapshotKey(CREATED_AT));
    if (typeof json !== 'string') {
        throw new TypeError('expected a saved project snapshot');
    }
    return (JSON.parse(json) as ProjectData).arrangement.tracks.map((track) => track.name);
}

describe('saveProject snapshot continuation', () => {
    beforeEach(() => {
        installNativePreparationWorker();
        vi.resetModules();
        localStorage.clear();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
    });

    afterEach(async () => {
        await settleNativePreparationWorkers();
        const [
            { configureDurableAudioBufferOwnership },
            { stopActiveAutoSave },
            { clearHandlerRegistry },
            { Container },
        ] = await Promise.all([
            import('#/modules/AudioEngine/useCases'),
            import('../../helpers/stopActiveAutoSave'),
            import('#/modules/Command/stores'),
            import('#/infra/di/Container'),
        ]);
        configureDurableAudioBufferOwnership(null);
        stopActiveAutoSave();
        clearHandlerRegistry();
        Container.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it(
        'saves when an autosave starts while the requested save waits in its preflight (#5984)',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const trace = await traceSnapshotWork();

            const requested = await startSaveHeldInPreflight(opened);
            trace.markSettled(requested.saving);
            const autosave = opened.project.saveProject();
            requested.release();

            expect({ requested: await requested.saving, autosave: await autosave }).toEqual({
                requested: true,
                autosave: true,
            });
            expect(opened.persistenceFailures()).toEqual([]);
            expect(opened.projectStore.value?.dirty).toBe(false);
            expect(trace.events).toEqual(SERIAL_SNAPSHOT_WORK);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'saves when the user saves while an autosave waits in its preflight',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const trace = await traceSnapshotWork();

            const autosave = await startSaveHeldInPreflight(opened);
            trace.markSettled(autosave.saving);
            const requested = opened.project.saveProject();
            autosave.release();

            expect({ autosave: await autosave.saving, requested: await requested }).toEqual({
                autosave: true,
                requested: true,
            });
            expect(opened.persistenceFailures()).toEqual([]);
            expect(trace.events).toEqual(SERIAL_SNAPSHOT_WORK);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'captures plugin state again for a save queued after a dirty mark during the earlier save',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const trace = await traceSnapshotWork();

            const first = await startSaveHeldInPreflight(opened);
            trace.markSettled(first.saving);
            opened.project.markDirty();
            const queued = opened.project.saveProject();
            first.release();

            expect({ first: await first.saving, queued: await queued }).toEqual({ first: true, queued: true });
            expect(opened.persistenceFailures()).toEqual([]);
            expect(trace.events).toEqual(SERIAL_SNAPSHOT_WORK);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'persists an edit that refused the earlier save through the save queued behind it',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();

            const first = await startSaveHeldInPreflight(opened);
            opened.renameTrack(opened.track.id, 'Edited during the first save');
            const queued = opened.project.saveProject();
            first.release();

            expect({ first: await first.saving, queued: await queued }).toEqual({ first: false, queued: true });
            expect(opened.persistenceFailures()).toEqual([`${REFUSAL_PREFIX}: the project revision moved`]);
            expect(savedTrackNames(indexedDb, opened)).toEqual(['Edited during the first save']);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'keeps saving after a save rejects outside its failure handling',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const snapshotKeyModule = await import('../../getProjectSnapshotKey');
            const failure = new Error('snapshot key unavailable');
            vi.spyOn(snapshotKeyModule, 'getProjectSnapshotKey').mockImplementationOnce(() => {
                throw failure;
            });
            const unhandled: unknown[] = [];
            const recordUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', recordUnhandled);
            try {
                const first = opened.project.saveProject();
                const second = opened.project.saveProject();
                const settled = await Promise.allSettled([first, second]);
                await new Promise((resolve) => setTimeout(resolve, 0));
                const third = await opened.project.saveProject();
                await new Promise((resolve) => setTimeout(resolve, 0));

                expect(settled).toEqual([
                    { status: 'rejected', reason: failure },
                    { status: 'fulfilled', value: true },
                ]);
                expect(third).toBe(true);
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', recordUnhandled);
            }
            expect(opened.projectStore.value?.dirty).toBe(false);
            expect(savedTrackNames(indexedDb, opened)).toEqual(['Close Drums']);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'saves when the cached clip PCM becomes durable while the preflight waits for it',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            indexedDb.pauseAudioWriteSettlements();
            const opened = await openProjectWithCachedStereoClip();
            await vi.waitFor(() => expect(indexedDb.pendingAudioWriteSettlements()).toBe(1));

            const requestedBefore = lockManager.requestedNames.length;
            const saving = opened.project.saveProject();
            await vi.waitFor(() => expect(lockManager.requestedNames.length).toBeGreaterThan(requestedBefore));
            expect(indexedDb.pendingAudioWriteSettlements()).toBe(1);
            indexedDb.resumeAudioWriteSettlements();
            while (indexedDb.pendingAudioWriteSettlements() > 0) {
                indexedDb.releaseNextAudioWriteSettlement();
            }

            expect(await saving).toBe(true);
            expect(opened.persistenceFailures()).toEqual([]);
            expect(indexedDb.get('sourdaw-audio', 'buffers', opened.bufferId)).toBeDefined();
        },
        CASE_TIMEOUT_MS
    );

    it(
        'refuses a project edit that lands while the preflight waits',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();

            const save = await startSaveHeldInPreflight(opened);
            opened.renameTrack(opened.track.id, 'Edited during the save window');
            save.release();

            expect(await save.saving).toBe(false);
            expect(opened.projectStore.value?.dirty).toBe(true);
            expect(opened.persistenceFailures()).toEqual([`${REFUSAL_PREFIX}: the project revision moved`]);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'abandons a Worker materialization as soon as an edit lands, then saves the latest revision (#7500)',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const workerFinished = Promise.withResolvers<void>();
            const worker = await stubSlowMaterializationWorker(async ({ signal, afterTask }) => {
                afterTask(() => {
                    // Detect publishes its markers while the Worker still materializes the save's rows.
                    opened.renameTrack(opened.track.id, 'Edited while the Worker materialized');
                });
                await Promise.race([workerFinished.promise, rejectWhenAborted(signal)]);
            });

            const saving = opened.project.saveProject();
            // The Worker has not answered, so only the edit itself can have told the save to stop waiting for it.
            await vi.waitFor(() => expect(worker.signals[0]?.aborted).toBe(true));
            workerFinished.resolve();

            expect(await saving).toBe(true);
            expect(worker.signals).toHaveLength(1);
            expect(opened.persistenceFailures()).toEqual([]);
            expect(savedTrackNames(indexedDb, opened)).toEqual(['Edited while the Worker materialized']);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'keeps waiting for the Worker when a watched store is set to the value it already holds',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const workerFinished = Promise.withResolvers<void>();
            const sameValueSet = Promise.withResolvers<void>();
            const worker = await stubSlowMaterializationWorker(async ({ signal, afterTask }) => {
                afterTask(() => {
                    opened.projectStore.set(opened.projectStore.value);
                    sameValueSet.resolve();
                });
                await Promise.race([workerFinished.promise, rejectWhenAborted(signal)]);
            });

            const saving = opened.project.saveProject();
            await sameValueSet.promise;
            expect(worker.signals[0]?.aborted).toBe(false);
            workerFinished.resolve();

            // The stub cannot supply a real Worker answer, so the first attempt ends at materialization; it must
            // get that far, with no second attempt, because the same-value set left its inputs current.
            await saving;
            expect(worker.signals).toHaveLength(1);
            expect(worker.materializeCalls()).toBe(1);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'never materializes a stale Worker answer and saves the edit that made it stale',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const worker = await stubSlowMaterializationWorker(async ({ afterTask }) => {
                afterTask(() => {
                    opened.renameTrack(opened.track.id, 'Edited after admission');
                });
                // The Worker answers although the edit already made that answer stale.
                await new Promise<void>((resolve) => afterTask(resolve));
            });

            expect(await opened.project.saveProject()).toBe(true);

            expect(worker.signals).toHaveLength(1);
            expect(worker.materializeCalls()).toBe(0);
            expect(opened.persistenceFailures()).toEqual([]);
            expect(savedTrackNames(indexedDb, opened)).toEqual(['Edited after admission']);
        },
        CASE_TIMEOUT_MS
    );

    it.each([
        {
            changed: 'the project',
            change: (opened: OpenedProject) => {
                opened.project.renameProject('Renamed during preparation');
            },
        },
        {
            changed: 'the arrangements',
            change: (_opened: OpenedProject, arrangementStore: ArrangementStore) => {
                const current = arrangementStore.value!;
                arrangementStore.set({
                    ...current,
                    arrangements: current.arrangements.map((row) =>
                        row.id === current.activeArrangementId ? { ...row, name: 'Renamed during preparation' } : row
                    ),
                });
            },
        },
    ])(
        'abandons the Worker request when only $changed changes, then saves the latest value',
        async ({ change }) => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const { arrangementStore } = await import('../../../../stores/arrangementStore');
            const workerFinished = Promise.withResolvers<void>();
            const worker = await stubSlowMaterializationWorker(async ({ signal, afterTask }) => {
                afterTask(() => {
                    change(opened, arrangementStore);
                });
                await Promise.race([workerFinished.promise, rejectWhenAborted(signal)]);
            });

            const saving = opened.project.saveProject();
            await vi.waitFor(() => expect(worker.signals[0]?.aborted).toBe(true));
            workerFinished.resolve();

            expect(await saving).toBe(true);
            expect(opened.persistenceFailures()).toEqual([]);
        },
        CASE_TIMEOUT_MS
    );

    it.each([
        {
            outcome: 'an answered request',
            behaviour: async () => undefined,
            // Only a real Worker answer lets materialization complete; the subscriptions must still be released.
            failure: 'Prospective mutation Worker has not completed',
        },
        {
            outcome: 'a failed request',
            behaviour: () => Promise.reject(new Error('Worker failed')),
            failure: 'Worker failed',
        },
    ])(
        'leaves no watched store subscribed after $outcome',
        async ({ behaviour, failure }) => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const subscriptions = await countStoreSubscriptions();
            const worker = await stubSlowMaterializationWorker(behaviour);
            const before = subscriptions.active();

            const result = await opened.project.saveProject();

            expect(opened.persistenceFailures()).toEqual([failure]);
            expect(result).toBe(false);
            expect(worker.signals).toHaveLength(1);
            expect(subscriptions.active()).toBe(before);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'leaves no watched store subscribed after an edit aborted the request',
        async () => {
            installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const subscriptions = await countStoreSubscriptions();
            const worker = await stubSlowMaterializationWorker(async ({ signal, afterTask }) => {
                afterTask(() => {
                    opened.renameTrack(opened.track.id, 'Edited while the Worker materialized');
                });
                await rejectWhenAborted(signal);
            });
            const before = subscriptions.active();

            expect(await opened.project.saveProject()).toBe(true);

            expect(worker.signals[0]?.aborted).toBe(true);
            expect(subscriptions.active()).toBe(before);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'refuses a different PCM replacing a required buffer during the snapshot write',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();

            const save = await startSaveHeldAtSnapshotWrite(opened, indexedDb);
            opened.cacheAudioBuffer({
                buffer: stereoBuffer([0.9, 0.9, 0.9], [0.8, 0.8, 0.8]),
                bufferId: opened.bufferId,
            });
            save.release();

            expect(await save.saving).toBe(false);
            expect(opened.projectStore.value?.dirty).toBe(true);
            expect(opened.persistenceFailures()).toEqual([
                `${REFUSAL_PREFIX}: the required audio durability receipt is no longer current`,
            ]);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'refuses a required runtime entry evicted during the snapshot write',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();

            const save = await startSaveHeldAtSnapshotWrite(opened, indexedDb);
            opened.audioBufferCache.remove(opened.bufferId);
            save.release();

            expect(await save.saving).toBe(false);
            expect(opened.projectStore.value?.dirty).toBe(true);
            expect(opened.persistenceFailures()).toEqual([
                `${REFUSAL_PREFIX}: the required audio durability receipt is no longer current`,
            ]);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'refuses a project identity change during the snapshot write',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();

            const save = await startSaveHeldAtSnapshotWrite(opened, indexedDb);
            opened.projectStore.set({ ...opened.projectStore.value!, createdAt: CREATED_AT + 1 });
            save.release();

            expect(await save.saving).toBe(false);
            expect(opened.persistenceFailures()).toEqual([`${REFUSAL_PREFIX}: the project creation identity changed`]);
        },
        CASE_TIMEOUT_MS
    );
});
