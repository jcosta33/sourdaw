import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import {
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
import { clearLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectStore } from '../../../stores/projectStore';

import { setAutoSaveHandle } from './autoSaveHandle';
import { collectProjectAudioBufferIds } from './collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from './hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from './hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from './resetModuleStoresToDefault';
import { stopActiveAutoSave } from './stopActiveAutoSave';
import { verifyAudioBufferReferences } from './verifyAudioBufferReferences';

import type { HydratableProjectData } from './isHydratableProjectData';
import type { ProjectLoadTransaction } from './runProjectLoadTransaction';

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

type ProjectReplacementResult = { status: 'aborted' } | { status: 'committed'; degraded: boolean };

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
    if (currentProject) {
        projectStore.set({ ...currentProject, loading: true, initialized: false });
    }

    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return { status: 'aborted' };
        }
    } catch (error) {
        logPreparationFailure(context, error);
        return { status: 'aborted' };
    }

    let preparedEmbeddedBuffers: NonNullable<Awaited<ReturnType<typeof importCachedAudioBuffers>>>;
    let preparedStoredBuffers: Awaited<ReturnType<typeof prepareCachedAudioBuffersFromIdb>>;
    try {
        const audioContext = getAudioContext();
        const referencedIds = collectProjectAudioBufferIds({ data });
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
            return { status: 'aborted' };
        }
        preparedEmbeddedBuffers = embeddedCandidate;

        preparedStoredBuffers = await prepareCachedAudioBuffersFromIdb({
            audioContext,
            bufferIds: referencedIds.filter((id) => !embeddedBufferIds.has(id)),
            shouldContinue: transaction.isCurrent,
        });
    } catch (error) {
        logPreparationFailure(context, error);
        return { status: 'aborted' };
    }

    if (!preparedStoredBuffers || !transaction.isCurrent()) {
        return { status: 'aborted' };
    }

    try {
        await stopPlayback();
        if (!transaction.isCurrent()) {
            return { status: 'aborted' };
        }
        // Tear down the previous graph's native-plugin activation guards so the
        // incoming project re-activates its own instances on the next rebuild.
        clearLoadedExternalPlugins();
        resetAudioGraph();
    } catch (error) {
        logPreparationFailure(context, error);
        restorePreviousAudioGraph(context);
        return { status: 'aborted' };
    }

    let previousPersistenceStopped = false;
    try {
        stopActiveAutoSave();
        previousPersistenceStopped = true;
        resetCrdtProjectAuthority(data.meta.name);
        projectActionHistoryToStore();
    } catch (error) {
        logPreparationFailure(context, error);
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
        return { status: 'aborted' };
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
            runCommittedStep('stored audio buffer publication', preparedStoredBuffers.publish);
            runCommittedStep('embedded audio buffer publication', preparedEmbeddedBuffers.publish);
            runCommittedStep('module store reset', resetModuleStoresToDefault);
            runCommittedStep('arrangement hydration', () =>
                hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true })
            );
            runCommittedStep('module store hydration', () => hydrateModuleStoresFromProjectData(data));
            runCommittedStep('project metadata publication', () => {
                projectStore.set({
                    name: data.meta.name,
                    createdAt: data.meta.createdAt,
                    updatedAt: data.meta.updatedAt,
                    keyRoot: data.meta.keyRoot,
                    scaleName: data.meta.scaleName,
                    tuning: data.meta.tuning,
                    dirty: false,
                    loading: false,
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
