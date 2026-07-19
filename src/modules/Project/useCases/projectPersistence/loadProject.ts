import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { cancelFreezeTasksForProjectTransition } from '#/modules/Arrangement/useCases';
import { getAudioContext, prepareCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { runCommandTransitionExclusive } from '#/modules/Command/useCases';
import {
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';
import { finishProjectLoading } from '../finishProjectLoading';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { collectTrackStateAudioBufferIds } from './helpers/collectTrackStateAudioBufferIds';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export async function loadProject(
    runTransition: typeof runCommandTransitionExclusive = runCommandTransitionExclusive
): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return false;
        }
    } catch (error) {
        logger.error(new Error('Failed to end collaboration before loading project', { cause: error }));
        return false;
    }

    return runTransition(async (resetCommandHistory) => {
        try {
            await cancelFreezeTasksForProjectTransition();
            if (!transaction.isCurrent()) {
                return false;
            }
            flushAutomergeStorageWrites();

            const loaded = await loadCrdtProject({ shouldCommit: transaction.isCurrent });
            if (!transaction.isCurrent()) {
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
            if (!transaction.isCurrent()) {
                return false;
            }
            logger.error(
                new Error('[loadProject] Pre-commit activation failed; preserving current project state', {
                    cause: error,
                })
            );
            throw error;
        }

        const rootDoc = getCrdtDoc<{ tracks?: unknown }>(DOC_PREFIX_ROOT);
        const referencedBufferIds = collectTrackStateAudioBufferIds(rootDoc?.tracks);
        let preparedBuffers: Awaited<ReturnType<typeof prepareCachedAudioBuffersFromIdb>> = null;
        try {
            preparedBuffers = await prepareCachedAudioBuffersFromIdb({
                audioContext: getAudioContext(),
                bufferIds: referencedBufferIds,
                shouldContinue: () => true,
            });
        } catch (error) {
            logger.error(
                new Error('[loadProject] Project committed without restoring cached audio buffers', { cause: error })
            );
        }

        const postCommitErrors: unknown[] = [];
        function finishCommittedStep(step: () => void): void {
            try {
                step();
            } catch (error) {
                postCommitErrors.push(error);
            }
        }
        try {
            batchStoreUpdates(() => {
                if (preparedBuffers) {
                    finishCommittedStep(preparedBuffers.publish);
                } else {
                    postCommitErrors.push(new Error('Cached audio-buffer restoration did not complete'));
                }
                // Reset per-device-instance stores (§13.1) before hydration so stale
                // device state from a previously open project cannot leak into it.
                finishCommittedStep(resetModuleStoresToDefault);
                finishCommittedStep(projectCrdtToStores);
                finishCommittedStep(migrateAbsoluteMidiNotes);

                const project = projectStore.value;
                if (project?.loading) {
                    finishCommittedStep(() => projectStore.set({ ...project, loading: false, initialized: true }));
                }
                finishCommittedStep(resetCommandHistory);
            });
        } catch (error) {
            postCommitErrors.push(error);
        }
        if (postCommitErrors.length > 0) {
            logger.error(
                new AggregateError(
                    postCommitErrors,
                    '[loadProject] Project identity committed with degraded post-commit activation'
                )
            );
        }

        // Start debounced incremental auto-save so edits survive browser crashes.
        // Stop any previous auto-save loop first (e.g. if loadProject is called again).
        try {
            stopActiveAutoSave();
            setAutoSaveHandle(startCrdtAutoSave());
        } catch (error) {
            logger.error(new Error('[loadProject] Project committed without active auto-save', { cause: error }));
        }

        return true;
    });
}
