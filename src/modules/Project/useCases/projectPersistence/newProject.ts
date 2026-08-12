import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearRuntimeCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { removeProjectJson } from '../../repositories/project/removeProjectJson';
import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { projectStore, type ProjectStoreState } from '../../stores/projectStore';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import {
    projectLoadEpoch,
    type ProjectLoadTransaction,
    runProjectLoadTransaction,
} from './helpers/runProjectLoadTransaction';
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

function restorePreviousProjectRuntime(): void {
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.warn('[newProject] Previous audio graph restoration failed:', error);
    }
    try {
        setAutoSaveHandle(startCrdtAutoSave());
    } catch (error) {
        logger.warn('[newProject] Previous autosave restoration failed:', error);
    }
}

async function activateNewProject({
    name,
    previousTransientState,
    transaction,
}: ActivateNewProjectInput): Promise<boolean> {
    let graphTeardownStarted = false;
    let previousPersistenceStopped = false;
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return failNewProjectActivation({ previousTransientState, transaction });
        }

        const releaseRuntimeTransition = await projectLoadEpoch.acquireRuntimeTransition();
        try {
            await stopPlayback();
            if (!transaction.isCurrent()) {
                return failNewProjectActivation({ previousTransientState, transaction });
            }
            stopActiveAutoSave();
            previousPersistenceStopped = true;
            graphTeardownStarted = true;
            resetAudioGraph();
            await unloadLoadedExternalPlugins();
            if (!transaction.isCurrent()) {
                restorePreviousProjectRuntime();
                return failNewProjectActivation({ previousTransientState, transaction });
            }
            resetCrdtProjectAuthority(name);
        } finally {
            releaseRuntimeTransition();
        }
    } catch (error) {
        logger.warn('[newProject] Failed to activate project:', error);
        if (graphTeardownStarted || previousPersistenceStopped) {
            restorePreviousProjectRuntime();
        }
        return failNewProjectActivation({ previousTransientState, transaction });
    }

    let degraded = false;
    function runCommittedStep(step: string, operation: () => void): void {
        try {
            operation();
        } catch (error) {
            degraded = true;
            logger.warn(`[newProject] Committed project activation failed during ${step}:`, error);
        }
    }

    runCommittedStep('action history projection', projectActionHistoryToStore);
    runCommittedStep('module store reset', () => resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true }));
    runCommittedStep('arrangement reset', () => arrangementStore.set(structuredClone(defaultArrangementStoreState)));
    runCommittedStep('master track creation', () => addTrack({ name: 'Master', kind: 'master', select: false }));
    runCommittedStep('project metadata publication', () => {
        const createdAt = Date.now();
        projectStore.set({
            name,
            createdAt,
            updatedAt: createdAt,
            dirty: false,
            loading: false,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: {
                name: 'Equal Temperament',
                frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
            },
            productionBrief: createDefaultProductionBrief(createdAt),
            initialized: true,
        });
    });
    runCommittedStep('project cache removal', removeProjectJson);
    runCommittedStep('runtime audio buffer reset', clearRuntimeCachedAudioBuffers);
    runCommittedStep('undo history reset', clearUndoHistory);
    runCommittedStep('autosave start', () => setAutoSaveHandle(startCrdtAutoSave()));

    try {
        await compactProject();
    } catch (error) {
        degraded = true;
        logger.warn('[newProject] Initial CRDT snapshot persistence failed:', error);
    }

    if (degraded) {
        logger.warn('[newProject] Project activated with recovery errors; save before closing.');
    }
    return true;
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
