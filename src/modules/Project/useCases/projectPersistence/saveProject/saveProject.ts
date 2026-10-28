import { logger } from '#/infra/logger/appLogger';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { ensureCachedAudioBuffersDurable } from '#/modules/AudioEngine/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision, exportSdawFile, persistCrdtProject } from '#/modules/CrdtDocument/useCases';
import { countSettledTakes } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectDirectory } from '../../../repositories/project/projectDirectory';
import { projectDirectoryBinding } from '../../../repositories/project/projectDirectoryBinding';
import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { isNativeProjectRuntimeAvailable } from '../../isNativeProjectRuntimeAvailable';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';
import { getProjectSnapshotKey } from '../getProjectSnapshotKey';
import { collectProjectFreezeOnlyBufferIds } from '../helpers/collectProjectFreezeOnlyBufferIds';
import { collectProjectOriginalHashes } from '../helpers/collectProjectOriginalHashes';
import { unsavedClosedTakes } from '../helpers/unsavedClosedTakes';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

import { captureExternalPluginStates } from './captureExternalPluginStates';
import { collectProjectDirectoryPcm } from './collectProjectDirectoryPcm';

const {
    beginProjectDirectorySelection,
    bindProjectDirectoryRoot,
    cachedProjectDirectoryRoot,
    loadProjectDirectoryRoot,
    openProjectDirectory,
} = projectDirectoryBinding;

type AudioDurabilityReceipt = {
    isCurrent: () => boolean;
    release: () => void;
};

function assertProjectSnapshotAuthority(): void {
    if (agentProjectRepairStateStore.value !== null) {
        throw new Error('[saveProject] Project repair became required before snapshot persistence');
    }
}

function beginSaveFolderSelection(
    projectId: string | undefined,
    folderSaveAvailable: boolean
): Promise<FileSystemDirectoryHandle> | null {
    if (
        !folderSaveAvailable ||
        (projectId && cachedProjectDirectoryRoot(projectId)) ||
        !navigator.userActivation?.isActive
    ) {
        return null;
    }
    const selection = beginProjectDirectorySelection();
    void selection.catch(() => undefined);
    return selection;
}

async function captureRejectedPluginStates(): Promise<readonly string[]> {
    try {
        const capture = await captureExternalPluginStates();
        return capture.rejectedPlugins;
    } catch (error) {
        logger.warn('[saveProject] Native plugin state capture failed:', error);
        return [];
    }
}

async function commitProjectDirectory({
    projectId,
    createdAt,
    recentKey,
    selectedRoot,
    built,
    audioDurabilityReceipt,
    assertSnapshotContinuation,
}: {
    projectId: string;
    createdAt: number;
    recentKey: string;
    selectedRoot: Promise<FileSystemDirectoryHandle> | null;
    built: NonNullable<Awaited<ReturnType<typeof buildProjectData>>>;
    audioDurabilityReceipt: AudioDurabilityReceipt;
    assertSnapshotContinuation: (receipt?: AudioDurabilityReceipt) => void;
}): Promise<void> {
    const root = selectedRoot ? await selectedRoot : await loadProjectDirectoryRoot(projectId);
    if (!root) {
        throw new Error('[saveProject] Choose a project folder with Save before autosave can commit');
    }
    assertSnapshotContinuation(audioDurabilityReceipt);
    const directory = await openProjectDirectory(root, projectId, true);
    assertSnapshotContinuation(audioDurabilityReceipt);
    const isCurrent = (): boolean => {
        try {
            assertSnapshotContinuation(audioDurabilityReceipt);
            return true;
        } catch {
            return false;
        }
    };
    const { captureProjectOriginalMedia } = await import('#/modules/Collaboration/useCases');
    const originals = await captureProjectOriginalMedia(projectId, collectProjectOriginalHashes(built.data), isCurrent);
    assertSnapshotContinuation(audioDurabilityReceipt);
    const pcm = await collectProjectDirectoryPcm(built.requiredAudioBufferIds, isCurrent);
    assertSnapshotContinuation(audioDurabilityReceipt);
    const document = new Uint8Array(await exportSdawFile().arrayBuffer());
    assertSnapshotContinuation(audioDurabilityReceipt);
    await projectDirectory.write({
        directory,
        projectId,
        document,
        snapshot: JSON.stringify(built.data),
        media: originals.media,
        unavailableOriginals: originals.unavailable,
        pcm,
        freezeProjectIdByBufferId: new Map(collectProjectFreezeOnlyBufferIds(built.data).map((id) => [id, createdAt])),
        isCurrent,
    });
    assertSnapshotContinuation(audioDurabilityReceipt);
    await bindProjectDirectoryRoot(projectId, root, recentKey);
    assertSnapshotContinuation(audioDurabilityReceipt);
}

export async function saveProject(): Promise<boolean> {
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

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = getProjectSnapshotKey(project.createdAt);
    const folderSaveAvailable = !isNativeProjectRuntimeAvailable() && typeof window.showDirectoryPicker === 'function';
    // The picker must start in the same user-gesture turn, before migration or plugin capture awaits.
    const selectedRoot = beginSaveFolderSelection(project.projectId, folderSaveAvailable);

    try {
        await migrateActiveProjectIdentity();

        // Capture each loaded native plugin's live state chunk into project truth
        // before serialization, so a reopened project restores editor-driven state
        // (presets, oversampling, internal routing) instead of plugin defaults
        // (PH-3). A capture failure must not abort the save — the rest of the
        // project still persists. A PRECOMMIT rejection is reported back instead
        // of thrown: that plugin's live edit is not in project truth, so this
        // save must not read as a clean success for it.
        const rejectedCapturePlugins = await captureRejectedPluginStates();

        const current = projectStore.value;
        if (!current || current.createdAt !== project.createdAt) {
            throw new Error('[saveProject] Active project changed before persistence');
        }
        const persistedProject = current;

        // Keep the project dirty until every durable write succeeds. The
        // timestamp belongs to the snapshot being built, so publish it before
        // serialization and include it in the revision token below.
        projectStore.set({ ...current, updatedAt: Date.now(), dirty: true });

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
            const activeProject = projectStore.value;
            if (
                !activeProject ||
                activeProject.createdAt !== persistedProject.createdAt ||
                activeProject.projectId !== persistedProject.projectId ||
                captureProjectRevision() !== built.snapshotRevision ||
                (audioDurabilityReceipt !== undefined && !audioDurabilityReceipt.isCurrent())
            ) {
                throw new Error('[saveProject] Project or audio changed during snapshot persistence');
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

                    if (folderSaveAvailable) {
                        await commitProjectDirectory({
                            projectId: persistedProject.projectId!,
                            createdAt: persistedProject.createdAt,
                            recentKey,
                            selectedRoot,
                            built,
                            audioDurabilityReceipt,
                            assertSnapshotContinuation,
                        });
                    }

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
