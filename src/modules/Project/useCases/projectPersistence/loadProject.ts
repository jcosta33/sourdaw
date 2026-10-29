import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { migrateTrimmedClipPassTakes } from '#/modules/Arrangement/useCases';
import {
    clearRuntimeCachedAudioBuffers,
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction, reconcileSessionUndoForProject } from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    compactProject,
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    loadCrdtProject,
    persistCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes, readLegacyChordTrackMigration } from '#/modules/MIDI/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import {
    projectDirectoryBinding,
    type ProjectDirectoryBinding,
} from '../../repositories/project/projectDirectoryBinding';
import { projectStore } from '../../stores/projectStore';
import { finishProjectLoading } from '../finishProjectLoading';
import { getDurableProjectOwnerId } from '../getDurableProjectOwnerId';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { collectTrackStateAudioBufferIds } from './helpers/collectTrackStateAudioBufferIds';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction, type ProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';
import { verifyAudioBufferReferences } from './helpers/verifyAudioBufferReferences';
import { migrateActiveProjectIdentity } from './migrateActiveProjectIdentity';
import { prepareProjectDirectoryRead, type PreparedProjectDirectoryRead } from './projectDirectoryRead';
import { projectIdentityTransitionDependencies } from './projectIdentityTransitionDependencies';
import { whenProjectIdentityTransitionDependenciesConfigured } from './whenProjectIdentityTransitionDependenciesConfigured';

const { loadProjectDirectoryBinding } = projectDirectoryBinding;

type LoadProjectInput = {
    directory?: PreparedProjectDirectoryRead;
    transaction?: ProjectLoadTransaction;
    explicit?: boolean;
    shouldProceed?: () => boolean;
    shouldContinue?: () => boolean;
};

export async function loadProject({
    directory: providedDirectory,
    transaction: providedTransaction,
    explicit = false,
    shouldProceed,
    shouldContinue = () => true,
}: LoadProjectInput = {}): Promise<boolean> {
    const canContinue = () => shouldContinue() && shouldProceed?.() !== false;
    await whenProjectIdentityTransitionDependenciesConfigured();
    if (!canContinue()) {
        return false;
    }
    // Boot restore is subordinate: if the user picked a project on the
    // LaunchScreen while `initializeAudioEngine()` was resolving, that
    // transition is already preparing and must win. Yield to any mid-flight
    // transition rather than superseding it with the implicit startup restore.
    const transaction = providedTransaction ?? runProjectLoadTransaction({ yieldToInFlight: true });
    const canActivate = () => transaction.canActivate() && canContinue();
    const isCurrent = () => transaction.isCurrent() && canContinue();
    let directory = providedDirectory;
    try {
        if (!directory && !explicit && typeof window.showDirectoryPicker === 'function') {
            const binding: ProjectDirectoryBinding | null = await loadProjectDirectoryBinding('last');
            if (!canActivate()) {
                return false;
            }
            if (binding) {
                directory = await prepareProjectDirectoryRead(binding, canActivate);
            }
        }
    } catch (error) {
        if (!canActivate()) {
            return false;
        }
        throw error;
    }
    if (!canActivate()) {
        return false;
    }
    try {
        // Activation settles the preparation ticket even if the caller withdrew
        // during prepare. No document has been committed at this boundary.
        if (!(await transaction.prepare()) || !transaction.activate() || !canContinue()) {
            return false;
        }
    } catch (error) {
        logger.error(new Error('Failed to end collaboration before loading project', { cause: error }));
        return false;
    }

    let preparedDirectoryAudio: Awaited<ReturnType<typeof importCachedAudioBuffers>> | null = null;
    try {
        if (directory) {
            const { restoreProjectOriginalMedia } = await import('#/modules/Collaboration/useCases');
            await restoreProjectOriginalMedia(directory.projectId, directory.media, isCurrent);
            if (!isCurrent()) {
                return false;
            }
            preparedDirectoryAudio = await importCachedAudioBuffers({
                audioContext: getAudioContext(),
                buffers: directory.frozenAudioBuffers,
                decodedBuffers: directory.decodedAudioBuffers,
                cacheIds: [...Object.keys(directory.decodedAudioBuffers), ...Object.keys(directory.frozenAudioBuffers)],
                shouldContinue: isCurrent,
            });
            if (!preparedDirectoryAudio || !isCurrent()) {
                return false;
            }
            if (explicit) {
                await stopPlayback();
                if (!isCurrent()) {
                    return false;
                }
            }
        }
        let loaded: boolean;
        if (directory) {
            loaded = await directory.commitDocument(isCurrent);
        } else {
            loaded = await loadCrdtProject({ shouldCommit: isCurrent });
        }
        if (!isCurrent()) {
            return false;
        }
        if (!loaded) {
            // No persisted project (fresh profile): clear the loading state and
            // land on the LaunchScreen (initialized stays false) instead of
            // silently auto-creating a project. New / template / demo selections
            // run the unified createCrdtProject path from the launch flow.
            finishProjectLoading();
            return false;
        }
    } catch (error) {
        if (!isCurrent()) {
            return false;
        }
        logger.error(new Error('[loadProject] CRDT load failed; preserving persisted project', { cause: error }));
        throw error;
    }

    if (!isCurrent()) {
        return false;
    }

    const rootDoc = getCrdtDoc<{ chordTrack?: unknown; tracks?: unknown }>(DOC_PREFIX_ROOT);
    const referencedBufferIds = collectTrackStateAudioBufferIds(rootDoc?.tracks);
    const preparedBuffers =
        preparedDirectoryAudio ??
        (await prepareCachedAudioBuffersFromIdb({
            audioContext: getAudioContext(),
            bufferIds: referencedBufferIds,
            shouldContinue: isCurrent,
        }));
    if (!preparedBuffers || !isCurrent()) {
        if (preparedBuffers && 'cancel' in preparedBuffers) {
            preparedBuffers.cancel();
        }
        return false;
    }

    try {
        if (directory) {
            await clearRuntimeCachedAudioBuffers({
                retainedIds: new Set([
                    ...Object.keys(directory.decodedAudioBuffers),
                    ...Object.keys(directory.frozenAudioBuffers),
                ]),
            });
            if (!isCurrent()) {
                return false;
            }
            resetAudioGraph();
            if (explicit) {
                await unloadLoadedExternalPlugins();
                if (!isCurrent()) {
                    return false;
                }
            }
        }
        batchStoreUpdates(() => {
            preparedBuffers.publish();
            // Reset in-memory module/device state, then discard the reset writes at
            // the projection boundary before hydrating the newly loaded authority.
            resetModuleStoresToDefault({ resetGrooveTemplates: false, resetMidiState: false, resetYeastState: false });
            projectCrdtToStores({ resetProjections: true });
            migrateAbsoluteMidiNotes();
            migrateTrimmedClipPassTakes();

            // Buffers that failed to resolve out of IndexedDB are simply absent from
            // the cache — nothing above throws for them. Scan the hydrated track
            // state against the cache so the absence becomes a counted, inspectable
            // record instead of silent playback. Runs after `publish()` and
            // `projectCrdtToStores` so both sides of the comparison are current.
            verifyAudioBufferReferences();

            // `getDurableProjectOwnerId()` is not usable here: it demands
            // `initialized`, which this batch has not flipped true yet, so it
            // would read undefined for every restore. The raw projectId
            // `projectCrdtToStores` just hydrated is compared instead. A
            // legacy project without a canonical id tags `undefined` here,
            // so its first post-migration reload clears the mirror once;
            // `migrateActiveProjectIdentity` below then persists the
            // canonical id, and every later session tags and compares that
            // migrated id, so matching resumes from that reload on.
            reconcileSessionUndoForProject({
                projectId: projectStore.value?.projectId,
                captureWitness: captureDurableDocumentWitness,
            });
            if (directory && explicit) {
                clearUndoHistory();
            }
        });
    } finally {
        if ('cancel' in preparedBuffers) {
            preparedBuffers.cancel();
        }
    }

    if (directory) {
        if (!isCurrent()) {
            return false;
        }
        if ('persist' in preparedBuffers) {
            let persisted: boolean;
            try {
                persisted = await preparedBuffers.persist();
            } catch (error) {
                if (!isCurrent()) {
                    return false;
                }
                throw error;
            }
            if (!isCurrent()) {
                return false;
            }
            if (!persisted) {
                throw new Error('Project directory PCM could not be persisted');
            }
        }
        await compactProject();
        if (!isCurrent()) {
            return false;
        }
    }

    try {
        await migrateActiveProjectIdentity();
    } catch (error) {
        // The migration seam knows only about its own successors, so a project
        // *transition* that replaced the projection while its persistence was
        // in flight looks to it like a discarded write and it throws. That is
        // not a load failure — `loadProject` rejecting here reaches
        // `useAppInitialization` uncaught and toasts a boot failure over a
        // recent-project load that succeeded. `isCurrent()` is the
        // signal that a different project owns the projection now, so a
        // superseded load ends exactly as the guard below would end it, and a
        // genuine failure of this project's own migration still propagates.
        if (isCurrent()) {
            throw error;
        }
        return false;
    }
    if (!isCurrent()) {
        return false;
    }

    // Outside the batch on purpose. `batchStoreUpdates` defers subscriber
    // notification to the end of the batch, so the hydration writes above reach
    // their subscribers only once it returns — and the dirty tracker is one of
    // them, reading `loading` to tell a load apart from an edit (audit M-011).
    // Clearing the flag inside the batch let every cold start restore its
    // project and immediately flag it as having unsaved changes.
    const project = projectStore.value;
    if (project?.loading) {
        projectStore.set({ ...project, loading: false, initialized: true });
    }

    const durableOwnerId = getDurableProjectOwnerId();
    if (!durableOwnerId || !isCurrent()) {
        return false;
    }
    await projectIdentityTransitionDependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad?.({
        ownerId: durableOwnerId,
        isCurrent: () => isCurrent() && getDurableProjectOwnerId() === durableOwnerId,
        signal: transaction.signal,
    });

    if (!isCurrent()) {
        return false;
    }

    if (directory) {
        const { activateProjectOriginalMedia } = await import('#/modules/Collaboration/useCases');
        await activateProjectOriginalMedia(directory.projectId, [...directory.media.keys()], isCurrent);
        if (!isCurrent()) {
            return false;
        }
    }

    if (rootDoc && !Object.hasOwn(rootDoc, 'chordTrack')) {
        const migration = readLegacyChordTrackMigration();
        if (migration) {
            await executeAppAction(migration.action, {
                shouldExecute: isCurrent,
                skipMacroRecording: true,
                skipUndo: true,
            });
            if (!isCurrent()) {
                return false;
            }
            await persistCrdtProject();
            if (!isCurrent()) {
                return false;
            }
            migration.remove();
        }
    }

    // Start debounced incremental auto-save so edits survive browser crashes.
    // Stop any previous auto-save loop first (e.g. if loadProject is called again).
    stopActiveAutoSave();
    setAutoSaveHandle(startCrdtAutoSave());

    return true;
}
