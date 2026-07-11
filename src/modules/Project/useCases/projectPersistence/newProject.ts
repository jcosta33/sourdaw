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
    const transition = beginProjectIdentityTransition();
    const current_project = projectStore.value;
    if (current_project) {
        projectStore.set({ ...current_project, loading: true, initialized: false });
    }

    // Stop any in-flight playback and tear down the previous project's audio
    // graph before we start mutating stores for the new project.
    stopPlayback();
    resetAudioGraph();

    // 1. Initialize CRDT Document structure so subsequent .set() calls persist
    createCrdtProject({ name, canActivate: transition.isCurrent })
        .then((activated) => {
            if (!activated || !transition.isCurrent() || !transition.complete()) {
                return;
            }
            if (!transition.isCurrent()) {
                return;
            }
            resetModuleStoresToDefault();
            arrangementStore.set(structuredClone(defaultArrangementStoreState));
            addTrack({ name: 'Master', kind: 'master', select: false });
            removeProjectJson();
            clearCachedAudioBuffers();
            clearUndoHistory();
            if (!transition.isCurrent()) {
                return;
            }
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
            if (!transition.isCurrent()) {
                return;
            }
            stopActiveAutoSave();
            setAutoSaveHandle(startCrdtAutoSave());
        })
        .catch((error) => {
            logger.warn('[newProject] Failed to activate project:', error);
        });

}
