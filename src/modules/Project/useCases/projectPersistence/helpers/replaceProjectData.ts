import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import {
    clearRuntimeCachedAudioBuffers,
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createDefaultProductionBrief } from '../../../models/ProductionBrief';
import { deriveProjectIdFromMeta } from '../../../models/ProjectData';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { finishProjectLoading } from '../../finishProjectLoading';

import { setAutoSaveHandle } from './autoSaveHandle';
import { collectProjectAudioBufferIds } from './collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from './hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from './hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from './resetModuleStoresToDefault';
import { projectLoadEpoch, type ProjectLoadTransaction } from './runProjectLoadTransaction';
import { stopActiveAutoSave } from './stopActiveAutoSave';
import { verifyAudioBufferReferences } from './verifyAudioBufferReferences';

import type { HydratableProjectData } from './isHydratableProjectData';

type ReplaceProjectDataInput = {
    // May be async: post-commit persistence is an observed IndexedDB
    // transaction, and a rejected one must degrade the load rather than escape
    // as an unhandled rejection.
    afterCommit?: () => void | Promise<void>;
    context: 'applyImportedProjectData' | 'loadRecentProject';
    data: HydratableProjectData;
    /** Buffers an importer already decoded, keyed by buffer id — staged and
     * persisted through the same candidate as the embedded ones. */
    decodedAudioBuffers?: Record<string, AudioBuffer>;
    transaction: ProjectLoadTransaction;
};

type ProjectReplacementResult =
    | { status: 'aborted' }
    | { status: 'committed'; degraded: boolean }
    /** The authority switch happened and then the load threw: the incoming
     * project never arrived and the previous one is already gone. Distinct from
     * `aborted`, which means the previous session is still there. */
    | { status: 'failed' };

function logPreparationFailure(context: ReplaceProjectDataInput['context'], error: unknown): void {
    logger.error(new Error(`[${context}] Project replacement preparation failed`, { cause: error }));
}

function restorePreviousAudioGraph(context: ReplaceProjectDataInput['context']): void {
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.error(new Error(`[${context}] Previous audio graph restoration failed`, { cause: error }));
    }
}

export async function replaceProjectData({
    afterCommit,
    context,
    data,
    decodedAudioBuffers,
    transaction,
}: ReplaceProjectDataInput): Promise<ProjectReplacementResult> {
    const currentProject = projectStore.value;
    // Captured before the load claims the flags, so an abort can hand the
    // previous session back exactly as it was. Every abort returning through
    // `abortProjectReplacement` has left the previous session intact: none has
    // published any of the incoming project (hydration happens only in the
    // committed batch), and the audio-graph teardown abort rebuilds the previous
    // graph via `restorePreviousAudioGraph`. Mirrors `newProject`'s
    // `previousTransientState` / `failNewProjectActivation` pair.
    //
    // The one exception is a throw *after* the CRDT authority switch, which is
    // not an abort at all — the previous session no longer exists to restore,
    // and `restorePreviousAudioGraph` is a no-op there because the projection
    // reset has already emptied the track store. That path returns through
    // `failProjectReplacement` instead.
    const previousTransientState = currentProject
        ? { initialized: currentProject.initialized, loading: currentProject.loading }
        : null;
    // Claiming and restoring are one decision and need the same predicate. Every
    // caller allocates its transaction before a long await — `loadRecentProject`
    // before the project JSON read, `pickAndImportProjectFile` before
    // `file.text()` — so this can be entered already superseded. Writing the
    // flags there and then (correctly) declining to give them back on abort
    // lands in exactly the wedged state this guard exists to prevent.
    //
    // `canActivate()` is the whole test: `isCurrent()` is false here by
    // construction, because nothing has called `activate()` yet. And a
    // transaction that cannot activate can never commit — `prepare()` returns
    // false once a newer transition claims the prepared slot, and `activate()`
    // returns false once a newer one is active — so skipping the write never
    // skips it for a load that goes on to publish.
    if (currentProject && transaction.canActivate()) {
        projectStore.set({ ...currentProject, loading: true, initialized: false });
    }

    function abortProjectReplacement(): ProjectReplacementResult {
        // `loading` is not cosmetic: `markDirty` reads it to tell a load's
        // hydration writes apart from a user's edit, so an abort that leaves it
        // set kills dirty tracking for the rest of the session — the unsaved
        // indicator, the autosave (gated on `dirty`), and the save-before-import
        // guard all go with it.
        //
        // Only a transition that still owns the store may write. Once a newer
        // load has superseded this one, these entry values are stale: the newer
        // load has already written its own `loading: true`, and clearing it
        // mid-hydration would mark the project it is loading dirty.
        //
        // `canActivate()` alone, and it is the same predicate the entry write
        // uses — claiming and restoring are one decision. An `isCurrent() ||`
        // disjunct here would be dead: `isCurrent()` requires `activated` plus
        // `===` on both ordering counters, `canActivate()` only `>=` on the same
        // two, so `isCurrent()` implies `canActivate()`. `newProject.ts:31`
        // carries that dead disjunct; left alone, it is not this PR's file.
        if (transaction.canActivate()) {
            const project = projectStore.value;
            if (project && previousTransientState) {
                projectStore.set({ ...project, ...previousTransientState });
            }
        }
        return { status: 'aborted' };
    }

    function failProjectReplacement(): ProjectReplacementResult {
        // The authority switch already happened: `createProject` installed a
        // fresh empty root and `resetAutomergeStorageProjections` replaced every
        // root-doc store's value with its `hydrateMissing()` default. The user's
        // project is out of the stores and cannot be put back from here.
        //
        // So this is not an abort, and every step the abort path takes would
        // make things worse rather than better:
        //   - `restorePreviousAudioGraph()` is a no-op here — `ensureTrackStrips`
        //     reads `trackStore.value?.tracks`, which the projection reset just
        //     emptied. Calling it would only look like a recovery.
        //   - restarting autosave ends in `scheduleDurabilityAttempt(0)` →
        //     `compactProject()` → `saveAllToIdb`, whose contract is "replace
        //     all persisted documents". That would overwrite the user's project
        //     on disk with the empty one, within milliseconds. The load's
        //     `stopActiveAutoSave()` deliberately stays in force.
        //   - restoring `{ loading: false, initialized: true }` would present
        //     the empty project as a normally opened session and let the user
        //     keep working in it while their real one is gone.
        //
        // What is left is a dedicated failure surface. The transient flags
        // cannot carry this state: `{ initialized: false, loading: false }`
        // renders as the full editor mid-session, because `AppShell` latches
        // `launchReady` on the first open and never re-reveals the launch
        // screen (`AppShell.tsx:436-444`). That is the same "normally opened
        // session" outcome as restoring `initialized: true`, so the flags are
        // left claimed and `projectLoadFailureStore` is what the shell renders.
        //
        // Nothing compacted, so IndexedDB still holds the user's project and a
        // reload restores it — which is what the surface tells them to do.
        try {
            projectLoadFailureStore.set({
                message: 'Your previous session was closed to open this project, and the project failed to open.',
                projectName: data.meta.name,
            });
        } catch (error) {
            logger.error(new Error(`[${context}] Failed to publish the load failure`, { cause: error }));
        }
        // No `notifyUser` here. The surface above carries the same sentence and
        // does not auto-dismiss, and a toast would say it twice — the second
        // time invisibly, since the toast host is `z-50` under this overlay's
        // opaque `z-[10000]`.
        return { status: 'failed' };
    }

    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return abortProjectReplacement();
        }
    } catch (error) {
        logPreparationFailure(context, error);
        return abortProjectReplacement();
    }

    let preparedEmbeddedBuffers: NonNullable<Awaited<ReturnType<typeof importCachedAudioBuffers>>>;
    let preparedStoredBuffers: Awaited<ReturnType<typeof prepareCachedAudioBuffersFromIdb>>;
    let referencedIds: string[];
    try {
        const audioContext = getAudioContext();
        referencedIds = collectProjectAudioBufferIds({ data });
        const embeddedBufferIds = new Set([
            ...Object.keys(data.audioBuffers ?? {}),
            ...Object.keys(decodedAudioBuffers ?? {}),
        ]);
        const embeddedCandidate = await importCachedAudioBuffers({
            audioContext,
            buffers: data.audioBuffers ?? {},
            decodedBuffers: decodedAudioBuffers,
            cacheIds: referencedIds,
            shouldContinue: transaction.isCurrent,
        });
        if (!embeddedCandidate) {
            return abortProjectReplacement();
        }
        preparedEmbeddedBuffers = embeddedCandidate;

        preparedStoredBuffers = await prepareCachedAudioBuffersFromIdb({
            audioContext,
            bufferIds: referencedIds.filter((id) => !embeddedBufferIds.has(id)),
            shouldContinue: transaction.isCurrent,
        });
    } catch (error) {
        logPreparationFailure(context, error);
        return abortProjectReplacement();
    }

    if (!preparedStoredBuffers || !transaction.isCurrent()) {
        return abortProjectReplacement();
    }

    const releaseRuntimeTransition = await projectLoadEpoch.acquireRuntimeTransition();
    try {
        await stopPlayback();
        if (!transaction.isCurrent()) {
            releaseRuntimeTransition();
            return abortProjectReplacement();
        }
        resetAudioGraph();
        await unloadLoadedExternalPlugins();
        if (!transaction.isCurrent()) {
            restorePreviousAudioGraph(context);
            releaseRuntimeTransition();
            return abortProjectReplacement();
        }
    } catch (error) {
        logPreparationFailure(context, error);
        restorePreviousAudioGraph(context);
        releaseRuntimeTransition();
        return abortProjectReplacement();
    }

    let previousPersistenceStopped = false;
    let authorityReplaced = false;
    try {
        stopActiveAutoSave();
        previousPersistenceStopped = true;
        resetCrdtProjectAuthority(data.meta.name, () => {
            authorityReplaced = true;
        });
        projectActionHistoryToStore();
    } catch (error) {
        logPreparationFailure(context, error);
        if (authorityReplaced) {
            return failProjectReplacement();
        }
        restorePreviousAudioGraph(context);
        if (previousPersistenceStopped) {
            try {
                setAutoSaveHandle(startCrdtAutoSave());
            } catch (restartError) {
                logger.error(
                    new Error(`[${context}] Previous CRDT durability lifecycle restart failed`, {
                        cause: restartError,
                    })
                );
            }
        }
        return abortProjectReplacement();
    } finally {
        releaseRuntimeTransition();
    }

    let degraded = false;
    function runCommittedStep(step: string, operation: () => void): void {
        try {
            operation();
        } catch (error) {
            degraded = true;
            logger.error(
                new Error(`[${context}] Committed project replacement failed during ${step}`, { cause: error })
            );
        }
    }

    // Playback has stopped, the old graph is gone, and CRDT authority now owns
    // the incoming project. Remaining operations cannot become an abort.

    try {
        // Notification coalescing only: each write remains independently fallible
        // and is guarded so one owner failure cannot prevent later owner steps.
        batchStoreUpdates(() => {
            runCommittedStep('runtime audio buffer reset', () =>
                clearRuntimeCachedAudioBuffers({ retainedIds: referencedIds })
            );
            runCommittedStep('stored audio buffer publication', preparedStoredBuffers.publish);
            runCommittedStep('embedded audio buffer publication', preparedEmbeddedBuffers.publish);
            runCommittedStep('module store reset', resetModuleStoresToDefault);
            runCommittedStep('arrangement hydration', () =>
                hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true })
            );
            runCommittedStep('module store hydration', () => hydrateModuleStoresFromProjectData(data));
            runCommittedStep('project metadata publication', () => {
                projectStore.set({
                    projectId: data.meta.projectId ?? deriveProjectIdFromMeta(data.meta),
                    name: data.meta.name,
                    createdAt: data.meta.createdAt,
                    updatedAt: data.meta.updatedAt,
                    keyRoot: data.meta.keyRoot,
                    scaleName: data.meta.scaleName,
                    tuning: data.meta.tuning,
                    productionBrief: data.meta.productionBrief ?? createDefaultProductionBrief(data.meta.createdAt),
                    dirty: false,
                    // Still loading: `batchStoreUpdates` defers subscriber
                    // notification to the end of the batch, so the hydration
                    // writes above have not reached their subscribers yet. The
                    // dirty tracker is one of them, and it reads this flag to
                    // tell a load apart from an edit (audit M-011). Cleared
                    // below, once the flush has drained.
                    loading: true,
                    initialized: true,
                });
            });
            runCommittedStep('audio buffer verification', verifyAudioBufferReferences);
            runCommittedStep('undo history reset', clearUndoHistory);
        });
    } catch (error) {
        degraded = true;
        logger.error(
            new Error(`[${context}] Committed project replacement notification flush failed`, { cause: error })
        );
    } finally {
        // The batch has flushed; every hydration subscriber has run. The load
        // is over only now, so the module that owns that transition says so.
        //
        // In `finally` because this is the only write that clears `loading`,
        // and the `catch` above exists precisely because the flush is modelled
        // as fallible. A throw there must not leave the session stuck loading
        // with dirty tracking dead — the same end state the abort paths guard.
        runCommittedStep('project load completion', finishProjectLoading);
    }

    if (afterCommit) {
        try {
            await afterCommit();
        } catch (error) {
            degraded = true;
            logger.error(
                new Error(`[${context}] Committed project replacement failed during post-commit persistence`, {
                    cause: error,
                })
            );
        }
    }

    try {
        if (!(await preparedEmbeddedBuffers.persist())) {
            degraded = true;
            logger.error(new Error(`[${context}] Committed embedded audio buffer persistence failed`));
        }
    } catch (error) {
        degraded = true;
        logger.error(new Error(`[${context}] Committed embedded audio buffer persistence threw`, { cause: error }));
    }

    if (transaction.isCurrent()) {
        try {
            await compactProject();
        } catch (error) {
            degraded = true;
            logger.error(new Error(`[${context}] Initial CRDT snapshot persistence failed`, { cause: error }));
        }
    }

    if (transaction.isCurrent()) {
        runCommittedStep('CRDT durability lifecycle start', () => {
            setAutoSaveHandle(startCrdtAutoSave());
        });
    }

    if (degraded && transaction.isCurrent()) {
        runCommittedStep('recovery warning', () => {
            notifyUser('Project loaded with recovery errors. Save a new copy before closing.', 'warning');
        });
    }

    return { status: 'committed', degraded };
}
