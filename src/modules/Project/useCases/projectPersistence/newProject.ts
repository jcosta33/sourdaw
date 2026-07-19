import { logger } from '#/infra/logger/appLogger';
import { addTrack, cancelFreezeTasksForProjectTransition } from '#/modules/Arrangement/useCases';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { runCommandTransitionExclusive } from '#/modules/Command/useCases';
import { createCrdtProject, projectActionHistoryToStore, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { removeProjectJson } from '../../repositories/project/removeProjectJson';
import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { projectStore, type ProjectStoreState } from '../../stores/projectStore';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

type ActivateNewProjectInput = {
    name: string;
    previousTransientState: Pick<ProjectStoreState, 'initialized' | 'loading'> | null;
    resetCommandHistory: () => void;
    transaction: ProjectLoadTransaction;
};

function failNewProjectActivation({
    previousTransientState,
    transaction,
}: Pick<ActivateNewProjectInput, 'previousTransientState' | 'transaction'>): false {
    if (transaction.isCurrent() || transaction.canActivate()) {
        const project = projectStore.value;
        if (project && previousTransientState) {
            projectStore.set({ ...project, ...previousTransientState });
        }
    }
    return false;
}

async function activateNewProject({
    name,
    previousTransientState,
    resetCommandHistory,
    transaction,
}: ActivateNewProjectInput): Promise<boolean> {
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return failNewProjectActivation({ previousTransientState, transaction });
        }

        await stopPlayback();
        if (!transaction.isCurrent()) {
            return failNewProjectActivation({ previousTransientState, transaction });
        }
        await cancelFreezeTasksForProjectTransition();
        if (!transaction.isCurrent()) {
            return failNewProjectActivation({ previousTransientState, transaction });
        }
        resetAudioGraph();

        await createCrdtProject(name);
    } catch (error) {
        logger.warn('[newProject] Failed before project identity commit:', error);
        return failNewProjectActivation({ previousTransientState, transaction });
    }

    const postCommitErrors: unknown[] = [];
    const finishCommittedStep = (step: () => void): void => {
        try {
            step();
        } catch (error) {
            postCommitErrors.push(error);
        }
    };

    finishCommittedStep(projectActionHistoryToStore);
    finishCommittedStep(resetModuleStoresToDefault);
    finishCommittedStep(() => arrangementStore.set(structuredClone(defaultArrangementStoreState)));
    finishCommittedStep(() => addTrack({ name: 'Master', kind: 'master', select: false }));
    finishCommittedStep(() =>
        projectStore.set({
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            dirty: false,
            loading: false,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: {
                name: 'Equal Temperament',
                frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
            },
            initialized: true,
        })
    );
    finishCommittedStep(removeProjectJson);
    finishCommittedStep(clearCachedAudioBuffers);
    finishCommittedStep(resetCommandHistory);
    finishCommittedStep(() => {
        stopActiveAutoSave();
        setAutoSaveHandle(startCrdtAutoSave());
    });
    if (postCommitErrors.length > 0) {
        logger.warn(
            '[newProject] Project identity committed with degraded post-commit activation:',
            new AggregateError(postCommitErrors, 'Post-commit project activation failed')
        );
    }
    return true;
}

export function newProject(
    name = 'Untitled Project',
    runTransition: typeof runCommandTransitionExclusive = runCommandTransitionExclusive
): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    return runTransition((resetCommandHistory) => {
        const currentProject = projectStore.value;
        const previousTransientState = currentProject
            ? { initialized: currentProject.initialized, loading: currentProject.loading }
            : null;
        if (currentProject) {
            projectStore.set({ ...currentProject, loading: true, initialized: false });
        }
        return activateNewProject({ name, previousTransientState, resetCommandHistory, transaction });
    });
}
