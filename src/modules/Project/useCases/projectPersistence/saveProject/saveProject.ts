import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { ensureCachedAudioBuffersDurable } from '#/modules/AudioEngine/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision, persistCrdtProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';
import { getProjectSnapshotKey } from '../getProjectSnapshotKey';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

import { captureExternalPluginStates } from './captureExternalPluginStates';

type AudioDurabilityReceipt = {
    isCurrent: () => boolean;
    release: () => void;
};

function assertProjectSnapshotAuthority(): void {
    if (agentProjectRepairStateStore.value !== null) {
        throw new Error('[saveProject] Project repair became required before snapshot persistence');
    }
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

    const updatedAt = Date.now();

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = getProjectSnapshotKey(project.createdAt);

    let audioDurabilityReceipt: AudioDurabilityReceipt | undefined;
    try {
        await migrateActiveProjectIdentity();

        // Capture each loaded native plugin's live state chunk into project truth
        // before serialization, so a reopened project restores editor-driven state
        // (presets, oversampling, internal routing) instead of plugin defaults
        // (PH-3). A capture failure must not abort the save — the rest of the
        // project still persists.
        try {
            await captureExternalPluginStates();
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
        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built) {
            // No snapshot means nothing under recentKey to reopen. Listing
            // the project anyway is how a recent entry came to point at
            // nothing (ADR 0013).
            throw new Error('[saveProject] Project snapshot could not be built');
        }

        const assertSnapshotContinuation = (requiresAudioReceipt: boolean): void => {
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
                (requiresAudioReceipt && !audioDurabilityReceipt?.isCurrent())
            ) {
                throw new Error('[saveProject] Project or audio changed during snapshot persistence');
            }
        };

        assertSnapshotContinuation(false);
        const audioDurability = await ensureCachedAudioBuffersDurable(built.requiredAudioBufferIds);
        if (audioDurability.status !== 'durable') {
            throw new Error('[saveProject] Required audio PCM could not be made durable');
        }
        audioDurabilityReceipt = audioDurability;
        assertSnapshotContinuation(true);

        await persistCrdtProject();
        assertSnapshotContinuation(true);

        // Awaited, so a rejected transaction reaches the catch below rather
        // than being reported as a successful save.
        await writeNamedProjectJsonByKey(recentKey, JSON.stringify(built.data));
        assertSnapshotContinuation(true);

        // Only record the recent-projects entry once the snapshot write is
        // observed to have committed for the exact revision it serialized.
        // A newer edit leaves the stale snapshot unadvertised and the project
        // dirty so the next save can replace it.
        addToRecentProjects(persistedProject.name, recentKey);
        assertSnapshotContinuation(true);

        // The CRDT snapshot and named project file above establish the same
        // durable project identity and exact PCM set. Only this receipt may
        // clear dirty; replacement, removal, or transition invalidates it.
        const latest = projectStore.value!;
        projectStore.set({ ...latest, dirty: false, identityPersistencePending: false });
        return true;
    } catch (error) {
        logger.warn('[saveProject] Project persistence failed:', error);
        notifyUser('Save failed — your latest changes could not be persisted.', 'error');
        return false;
    } finally {
        audioDurabilityReceipt?.release();
    }
}
