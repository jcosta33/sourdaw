import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import {
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { compactProject, resetCrdtProjectAuthority, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

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
    afterCommit?: () => void;
    context: 'applyImportedProjectData' | 'loadRecentProject';
    data: HydratableProjectData;
    transaction: ProjectLoadTransaction;
};

type ProjectReplacementResult = { status: 'aborted' } | { status: 'committed'; degraded: boolean };

function logPreparationFailure(context: ReplaceProjectDataInput['context'], error: unknown): void {
    logger.error(new Error(`[${context}] Project replacement preparation failed`, { cause: error }));
}

export async function replaceProjectData({
    afterCommit,
    context,
    data,
    transaction,
}: ReplaceProjectDataInput): Promise<ProjectReplacementResult> {
    try {
        if (!transaction.activate()) {
            return { status: 'aborted' };
        }
    } catch (error) {
        logPreparationFailure(context, error);
        return { status: 'aborted' };
    }

    let preparedEmbeddedBuffers: Awaited<ReturnType<typeof importCachedAudioBuffers>> | undefined;
    let preparedStoredBuffers: Awaited<ReturnType<typeof prepareCachedAudioBuffersFromIdb>>;
    try {
        const audioContext = getAudioContext();
        const referencedIds = collectProjectAudioBufferIds({ data });
        const embeddedBufferIds = new Set(Object.keys(data.audioBuffers ?? {}));
        preparedEmbeddedBuffers = data.audioBuffers
            ? await importCachedAudioBuffers({
                  audioContext,
                  buffers: data.audioBuffers,
                  cacheIds: referencedIds,
                  shouldContinue: transaction.isCurrent,
              })
            : undefined;
        if (data.audioBuffers && !preparedEmbeddedBuffers) {
            return { status: 'aborted' };
        }

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

    let previousPersistenceStopped = false;
    try {
        stopActiveAutoSave();
        previousPersistenceStopped = true;
        resetCrdtProjectAuthority(data.meta.name);
    } catch (error) {
        logPreparationFailure(context, error);
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

    // The CRDT authority now owns the incoming project. Every remaining
    // operation is best-effort, and no later failure can turn it into an abort.
    runCommittedStep('transport shutdown', stopPlayback);
    runCommittedStep('audio graph reset', resetAudioGraph);

    try {
        // Notification coalescing only: each write remains independently fallible
        // and is guarded so one owner failure cannot prevent later owner steps.
        batchStoreUpdates(() => {
            runCommittedStep('stored audio buffer publication', preparedStoredBuffers.publish);
            if (preparedEmbeddedBuffers) {
                runCommittedStep('embedded audio buffer publication', preparedEmbeddedBuffers.publish);
            }
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
        runCommittedStep('post-commit persistence', afterCommit);
    }

    if (preparedEmbeddedBuffers) {
        try {
            if (!(await preparedEmbeddedBuffers.persist())) {
                degraded = true;
                logger.error(new Error(`[${context}] Committed embedded audio buffer persistence failed`));
            }
        } catch (error) {
            degraded = true;
            logger.error(new Error(`[${context}] Committed embedded audio buffer persistence threw`, { cause: error }));
        }
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

    return { status: 'committed', degraded };
}
