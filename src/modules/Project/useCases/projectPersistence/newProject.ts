import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { createCrdtProject, projectActionHistoryToStore, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { removeProjectJson } from '../../repositories/project/storageOperations';
import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { projectStore } from '../../stores/projectStore';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

type ActivateNewProjectInput = {
    name: string;
    transaction: ProjectLoadTransaction;
};

async function activateNewProject({ name, transaction }: ActivateNewProjectInput): Promise<void> {
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return;
        }

        await stopPlayback();
        if (!transaction.isCurrent()) {
            return;
        }
        resetAudioGraph();

        await createCrdtProject(name);
        if (!transaction.isCurrent()) {
            return;
        }
        projectActionHistoryToStore();
        resetModuleStoresToDefault();
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
    } catch (error) {
        logger.warn('[newProject] Failed to activate project:', error);
    }
}

export function newProject(name = 'Untitled Project'): void {
    const transaction = runProjectLoadTransaction();
    const currentProject = projectStore.value;
    if (currentProject) {
        projectStore.set({ ...currentProject, loading: true, initialized: false });
    }
    void activateNewProject({ name, transaction });
}
