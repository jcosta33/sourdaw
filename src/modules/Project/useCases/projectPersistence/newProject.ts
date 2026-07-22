import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
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
        resetAudioGraph();

        await createCrdtProject(name);
        if (!transaction.isCurrent()) {
            return failNewProjectActivation({ previousTransientState, transaction });
        }
        projectActionHistoryToStore();
        await executeAppAction({ type: 'toggleChordTrack', payload: { enabled: false } });
        await executeAppAction({ type: 'clearChordTrack' });
        resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        addTrack({ name: 'Master', kind: 'master', select: false });

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
        });
        removeProjectJson();
        clearCachedAudioBuffers();
        clearUndoHistory();

        stopActiveAutoSave();
        setAutoSaveHandle(startCrdtAutoSave());
        return true;
    } catch (error) {
        logger.warn('[newProject] Failed to activate project:', error);
        return failNewProjectActivation({ previousTransientState, transaction });
    }
}

export function newProject(name = 'Untitled Project'): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    const currentProject = projectStore.value;
    const previousTransientState = currentProject
        ? { initialized: currentProject.initialized, loading: currentProject.loading }
        : null;
    if (currentProject) {
        projectStore.set({ ...currentProject, loading: true, initialized: false });
    }
    return activateNewProject({ name, previousTransientState, transaction });
}
