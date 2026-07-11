import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { createCrdtProject, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { removeProjectJson } from '../../repositories/project/storageOperations';
import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { projectStore } from '../../stores/projectStore';

import { beginProjectIdentityTransition } from './beginProjectIdentityTransition';
import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export function newProject(name = 'Untitled Project'): void {
    const complete_project_identity_transition = beginProjectIdentityTransition();
    const current_project = projectStore.value;
    if (current_project) {
        projectStore.set({ ...current_project, loading: true, initialized: false });
    }

    // Stop any in-flight playback and tear down the previous project's audio
    // graph before we start mutating stores for the new project.
    stopPlayback();
    resetAudioGraph();

    // 1. Initialize CRDT Document structure so subsequent .set() calls persist
    createCrdtProject(name)
        .then(() => {
            complete_project_identity_transition();
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
            stopActiveAutoSave();
            setAutoSaveHandle(startCrdtAutoSave());
        })
        .catch((error) => {
            logger.warn('[newProject] Failed to activate project:', error);
        });

    resetModuleStoresToDefault();

    // Seed a single empty arrangement from the store's canonical default so the
    // seed shape and name ('Arrangement 1') stay defined in one place. Clone so a
    // fresh project never shares a reference with the module-level default.
    arrangementStore.set(structuredClone(defaultArrangementStoreState));

    // Don't auto-select the master track — nothing should be selected on a fresh project.
    addTrack({ name: 'Master', kind: 'master', select: false });

    removeProjectJson();
    clearCachedAudioBuffers();
    clearUndoHistory();
}
