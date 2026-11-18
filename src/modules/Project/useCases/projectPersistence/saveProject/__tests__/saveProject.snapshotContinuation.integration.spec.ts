import { MessageChannel } from 'node:worker_threads';

import { from, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { NativePreparationWorker, settleNativePreparationWorkers } from '../../../../__tests__/nativePreparationWorker';

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
        { getWorkspaceHandlers },
        { registerKernelPorts },
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
        import('#/modules/WorkspaceShell/useCases'),
        import('#/app/registerKernelPorts'),
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
    registerHandlerMap(getWorkspaceHandlers());
    registerKernelPorts();
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
        vi.resetModules();
        localStorage.clear();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        vi.stubGlobal('Worker', NativePreparationWorker);
        vi.stubGlobal('MessageChannel', MessageChannel);
    });

    afterEach(async () => {
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
        await settleNativePreparationWorkers();
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
        'refuses a queued outgoing save whose native authority was replaced under the same persisted identity',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const [crdt, migration, transport, { unsavedClosedTakes }] = await Promise.all([
                import('#/modules/CrdtDocument/useCases'),
                import('../../migrateActiveProjectIdentity'),
                import('#/modules/Transport/useCases'),
                import('../../helpers/unsavedClosedTakes'),
            ]);
            const first = await startSaveHeldInPreflight(opened);
            const trace = await traceSnapshotWork();
            const migrate = vi.spyOn(migration, 'migrateActiveProjectIdentity');
            const persist = vi.spyOn(crdt, 'persistCrdtProject');
            const expectedOutgoingProjectIdentity = crdt.captureProjectIdentity();
            const queued = opened.project.saveProject({ expectedOutgoingProjectIdentity });

            try {
                const projection = opened.projectStore.value;
                const root = crdt.getCrdtDoc<{ projectMeta: { projectId: string; createdAt: number } }>('root');
                if (!root || !projection) {
                    throw new Error('expected a native root and its project projection');
                }
                crdt.replaceCrdtDoc({ id: 'root', doc: from(toJS(root)) });
                expect(crdt.captureProjectIdentity()).not.toBe(expectedOutgoingProjectIdentity);
                const successor = crdt.getCrdtDoc<{ projectMeta: { projectId: string; createdAt: number } }>('root');
                expect(successor?.projectMeta).toMatchObject({
                    projectId: projection.projectId,
                    createdAt: projection.createdAt,
                });
                expect(opened.projectStore.value).toBe(projection);

                // A new closed take would be acknowledged if the stale save were allowed to complete.
                vi.spyOn(transport, 'countSettledTakes').mockReturnValue(1);
                expect(unsavedClosedTakes.hasUnsaved()).toBe(true);
            } finally {
                first.release();
            }

            expect({ first: await first.saving, queued: await queued }).toEqual({ first: false, queued: false });
            expect(migrate).not.toHaveBeenCalled();
            expect(trace.events).toEqual([]);
            expect(persist).not.toHaveBeenCalled();
            const recentKey = opened.project.getProjectSnapshotKey(CREATED_AT);
            expect(indexedDb.get('sourdaw-projects', 'projects', recentKey)).toBeUndefined();
            expect(opened.project.getRecentProjects()).toEqual([]);
            expect(opened.projectStore.value?.dirty).toBe(true);
            expect(unsavedClosedTakes.hasUnsaved()).toBe(true);
        },
        CASE_TIMEOUT_MS
    );

    it(
        'saves an edit under the same outgoing authority while the replacement is loading',
        async () => {
            const indexedDb = installMultiDatabaseIndexedDb();
            const opened = await openProjectWithCachedStereoClip();
            const { captureProjectIdentity } = await import('#/modules/CrdtDocument/useCases');
            const first = await startSaveHeldInPreflight(opened);
            const expectedOutgoingProjectIdentity = captureProjectIdentity();
            const queued = opened.project.saveProject({ expectedOutgoingProjectIdentity });

            try {
                const project = opened.projectStore.value;
                if (!project) {
                    throw new Error('expected an outgoing project');
                }
                opened.projectStore.set({ ...project, loading: true, initialized: false });
                opened.renameTrack(opened.track.id, 'Edited in the outgoing project');
                expect(captureProjectIdentity()).toBe(expectedOutgoingProjectIdentity);
            } finally {
                first.release();
            }

            expect({ first: await first.saving, queued: await queued }).toEqual({ first: false, queued: true });
            expect(savedTrackNames(indexedDb, opened)).toEqual(['Edited in the outgoing project']);
            expect(opened.project.getRecentProjects()).toMatchObject([
                { key: opened.project.getProjectSnapshotKey(CREATED_AT) },
            ]);
            expect(opened.projectStore.value).toMatchObject({ dirty: false, loading: true, initialized: false });
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
