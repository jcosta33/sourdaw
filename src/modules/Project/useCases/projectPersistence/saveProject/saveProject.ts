import { logger } from '#/infra/logger/appLogger';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { ensureCachedAudioBuffersDurable } from '#/modules/AudioEngine/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision, persistCrdtProject } from '#/modules/CrdtDocument/useCases';
import { countSettledTakes } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';
import { getProjectSnapshotKey } from '../getProjectSnapshotKey';
import { unsavedClosedTakes } from '../helpers/unsavedClosedTakes';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

import { captureExternalPluginStates } from './captureExternalPluginStates';

type AudioDurabilityReceipt = {
    isCurrent: () => boolean;
    release: () => void;
};

let latestSave: Promise<boolean> | undefined;

function assertProjectSnapshotAuthority(): void {
    if (agentProjectRepairStateStore.value !== null) {
        throw new Error('[saveProject] Project repair became required before snapshot persistence');
    }
}

/** Names the one authority that moved since the snapshot, so a refusal seen only in a remote log says which. */
function describeSnapshotChange(
    persistedProject: ProjectStoreState,
    snapshotRevision: string,
    audioDurabilityReceipt: AudioDurabilityReceipt | undefined
): string | null {
    const activeProject = projectStore.value;
    if (!activeProject) {
        return 'the project closed';
    }
    if (activeProject.createdAt !== persistedProject.createdAt) {
        return 'the project creation identity changed';
    }
    if (activeProject.projectId !== persistedProject.projectId) {
        return 'the project id changed';
    }
    if (captureProjectRevision() !== snapshotRevision) {
        return 'the project revision moved';
    }
    if (audioDurabilityReceipt !== undefined && !audioDurabilityReceipt.isCurrent()) {
        return 'the required audio durability receipt is no longer current';
    }
    return null;
}

/**
 * Saves run one at a time, and each persists its own snapshot. Every save
 * publishes a fresh `updatedAt` into the project before it builds its
 * snapshot, so a second save overlapping the first (the 30 s autosave firing
 * during a Save the user asked for) moved the first one's revision and the
 * first save refused itself (#5984).
 */
export function saveProject(): Promise<boolean> {
    const save = runSaveAfter(latestSave);
    latestSave = save;
    // Only a save still in flight is waited on: once it settles, fulfilled or
    // rejected, the next save starts at once.
    const releaseQueueSlot = (): void => {
        if (latestSave === save) {
            latestSave = undefined;
        }
    };
    void save.then(releaseQueueSlot, releaseQueueSlot);
    // The caller gets its own promise, which nothing here handles, so a
    // rejection it ignores still reports as unhandled, as it did before the queue.
    return save.then((saved) => saved);
}

async function runSaveAfter(predecessor: Promise<boolean> | undefined): Promise<boolean> {
    if (predecessor) {
        // Only the order matters here; the predecessor's own caller receives
        // its result, rejection included, through the promise it was handed.
        await predecessor.catch(() => undefined);
    }
    return persistProjectSnapshot();
}

async function persistProjectSnapshot(): Promise<boolean> {
    // Everything below assumes `projectStore` identifies the project the other
    // stores hold. That pairing only survives while a project is open. After a
    // load replaced the CRDT authority and then failed, `projectStore` still
    // carries the *previous* project's `name` and `createdAt` — the metadata
    // write lives in the batch that never ran — while every other store holds
    // its projection default. So `recentKey` resolves to the user's real
    // project and `buildProjectData()` serialises the emptied stores into it.
    //
    // Guarded here rather than at the call sites because there are eight of
    // them, and one needs no user at all: `dirty` is still true and
    // `stopPlayback()` already ran, so `useAppInitialization`'s 30 s autosave
    // interval fires on its own within half a minute of the failure, and
    // `handleSaveProject` can be driven through `executeAppAction` by an AI
    // response that resolves after it.
    //
    // NOTE for callers: unlike the `false` returned from the catch below, this
    // one is NOT accompanied by a notification. The failure surface is already
    // on screen saying so, and the shell around it is `inert`, which takes the
    // toast host out of the accessibility tree. Do not read a `false` from this
    // function as "the user has been told" — several comments below say
    // "already notified", and that only holds for the catch.
    if (projectLoadFailureStore.value !== null) {
        return false;
    }

    const project = projectStore.value;
    if (!project) {
        return true;
    }

    const updatedAt = Date.now();

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = getProjectSnapshotKey(project.createdAt);

    try {
        await migrateActiveProjectIdentity();

        // Capture each loaded native plugin's live state chunk into project truth
        // before serialization, so a reopened project restores editor-driven state
        // (presets, oversampling, internal routing) instead of plugin defaults
        // (PH-3). A capture failure must not abort the save — the rest of the
        // project still persists. A PRECOMMIT rejection is reported back instead
        // of thrown: that plugin's live edit is not in project truth, so this
        // save must not read as a clean success for it.
        let rejectedCapturePlugins: readonly string[] = [];
        try {
            const capture = await captureExternalPluginStates();
            rejectedCapturePlugins = capture.rejectedPlugins;
        } catch (error) {
            logger.warn('[saveProject] Native plugin state capture failed:', error);
        }

        const current = projectStore.value;
        if (!current || current.createdAt !== project.createdAt) {
            throw new Error('[saveProject] Active project changed before persistence');
        }
        const persistedProject = current;

        // Keep the project dirty until every durable write succeeds. The
        // timestamp belongs to the snapshot being built, so publish it before
        // serialization and include it in the revision token below.
        projectStore.set({ ...current, updatedAt, dirty: true });

        // Write a flat-JSON ProjectData snapshot under the SAME key the
        // recent entry uses, so loadRecentProject can reopen it. The
        // snapshot is the persisted per-project save; the CRDT doc (above)
        // is the live active document. One shared buildProjectData()
        // serializer backs both this snapshot and the .sourdaw export, so
        // they can't drift from the shape
        // hydrateModuleStoresFromProjectData expects.
        //
        // The snapshot references audio by buffer id and embeds no PCM
        // (ADR 0013 decision 2). The audio of record is the runtime cache's
        // own IndexedDB store, which already holds the same samples as raw
        // Float32Array; base64 in this snapshot was a second copy of it,
        // paid for at ~430 ms of main thread per minute of stereo and 1.333x
        // in bytes. loadRecentProject resolves the ids through the cache,
        // exactly as the boot restore path already does.
        //
        // Read in the same synchronous turn as the snapshot's revision, so a
        // take that settles once the snapshot is taken still counts as unsaved.
        const settledTakesAtSnapshot = countSettledTakes();
        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built) {
            // No snapshot means nothing under recentKey to reopen. Listing
            // the project anyway is how a recent entry came to point at
            // nothing (ADR 0013).
            throw new Error('[saveProject] Project snapshot could not be built');
        }

        const assertSnapshotContinuation = (audioDurabilityReceipt?: AudioDurabilityReceipt): void => {
            // A public project edit updates its store immediately but may defer
            // the corresponding Automerge write until the next animation frame.
            // Expose that write before every post-await authority check so the
            // original serialized revision cannot certify a newer visible state.
            flushAutomergeStorageWrites();
            assertProjectSnapshotAuthority();
            const change = describeSnapshotChange(persistedProject, built.snapshotRevision, audioDurabilityReceipt);
            if (change !== null) {
                throw new Error(`[saveProject] Project or audio changed during snapshot persistence: ${change}`);
            }
        };

        let preflightReceipt: AudioDurabilityReceipt | undefined;
        try {
            assertSnapshotContinuation();
            const preflight = await ensureCachedAudioBuffersDurable(built.requiredAudioBufferIds);
            if (preflight.status !== 'durable') {
                throw new Error('[saveProject] Required audio PCM could not be made durable');
            }
            preflightReceipt = preflight;
            assertSnapshotContinuation(preflightReceipt);

            const admittedPreflightReceipt = preflightReceipt;
            return await withProjectAudioStorageLock(async (scope) => {
                let audioDurabilityReceipt: AudioDurabilityReceipt | undefined;
                try {
                    // A writer can publish its pending source after this Save
                    // queued but before it acquired the lock. Reject that
                    // receipt before awaiting any writer queued behind us.
                    assertSnapshotContinuation(admittedPreflightReceipt);
                    admittedPreflightReceipt.release();
                    preflightReceipt = undefined;
                    const lockedDurability = ensureCachedAudioBuffersDurable(built.requiredAudioBufferIds, scope);
                    const audioDurability = await lockedDurability;
                    if (audioDurability.status !== 'durable') {
                        throw new Error('[saveProject] Required audio PCM could not be made durable');
                    }
                    audioDurabilityReceipt = audioDurability;
                    assertSnapshotContinuation(audioDurabilityReceipt);

                    await persistCrdtProject();
                    assertSnapshotContinuation(audioDurabilityReceipt);

                    // Awaited, so a rejected transaction reaches the catch below
                    // rather than being reported as a successful save.
                    await writeNamedProjectJsonByKey(recentKey, JSON.stringify(built.data));
                    assertSnapshotContinuation(audioDurabilityReceipt);

                    // Only record the recent-projects entry once the snapshot
                    // write committed for the exact revision it serialized.
                    addToRecentProjects(persistedProject.name, recentKey);
                    assertSnapshotContinuation(audioDurabilityReceipt);

                    // The CRDT snapshot and named project file establish the same
                    // durable project identity and exact PCM set. A rejected
                    // plugin capture left that plugin's live edit out of project
                    // truth, so keep the project dirty for the next save attempt.
                    const latest = projectStore.value!;
                    projectStore.set({
                        ...latest,
                        dirty: rejectedCapturePlugins.length > 0,
                        identityPersistencePending: false,
                    });
                    unsavedClosedTakes.markSavedThrough(settledTakesAtSnapshot);
                    return true;
                } finally {
                    audioDurabilityReceipt?.release();
                }
            });
        } finally {
            preflightReceipt?.release();
        }
    } catch (error) {
        logger.warn('[saveProject] Project persistence failed:', error);
        notifyUser('Save failed — your latest changes could not be persisted.', 'error');
        return false;
    }
}
