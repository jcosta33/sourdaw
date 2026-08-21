import { logger } from '#/infra/logger/appLogger';
import { captureProjectRevision, persistCrdtProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { NAMED_PROJECT_KEY_PREFIX } from '../../../models/ProjectData';
import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

import { captureExternalPluginStates } from './captureExternalPluginStates';

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
    const recentKey = `${NAMED_PROJECT_KEY_PREFIX}${project.createdAt}`;

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

        // buildProjectData synchronizes the current arrangement projection into
        // project truth, then persist it.
        await persistCrdtProject();

        // Capture the revision AFTER the save's own CRDT bookkeeping
        // (buildProjectData's arrangement sync + the incremental persist) has
        // settled. Capturing before persist compared the post-save guard
        // against a baseline the save itself invalidated — persistCrdtProject
        // advances the Automerge mutationEpoch/heads as a side effect of its
        // own commit, so the pre-persist token never matched the post-persist
        // one and dirty could never clear. The guard now trips only on an edit
        // arriving after persist but before the snapshot write commits — the
        // genuine concurrent-edit case it was written to catch.
        const savedRevision = captureProjectRevision();

        // Awaited, so a rejected transaction reaches the catch below rather
        // than being reported as a successful save.
        await writeNamedProjectJsonByKey(recentKey, JSON.stringify(built.data));

        // Only record the recent-projects entry once the snapshot write is
        // observed to have committed — otherwise we'd list a project that
        // was never actually saved.
        addToRecentProjects(project.name, recentKey);

        // A save clears dirty only when the complete project authority still
        // matches the revision captured above. Any edit or project identity
        // transition during the async snapshot write keeps dirty asserted so
        // the next autosave cannot be suppressed by a stale completion.
        const latest = projectStore.value;
        if (latest?.createdAt === project.createdAt && captureProjectRevision() === savedRevision) {
            projectStore.set({ ...latest, dirty: false });
        }
        return true;
    } catch (error) {
        logger.warn('[saveProject] Project persistence failed:', error);
        notifyUser('Save failed — your latest changes could not be persisted.', 'error');
        return false;
    }
}
