import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { createCrdtProject, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { projectStore } from '../../stores/projectStore';
import { removeProjectJson } from '../../repositories/project/storageOperations';
import { setAutoSaveHandle, stopActiveAutoSave } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';

export function newProject(name = 'Untitled Project'): void {
    // Stop any in-flight playback and tear down the previous project's audio
    // graph before we start mutating stores for the new project.
    stopPlayback();
    resetAudioGraph();

    // 1. Initialize CRDT Document structure so subsequent .set() calls persist
    createCrdtProject(name).catch((error) => {
        logger.warn('[newProject] Failed to initialize CRDT structure:', error);
    });

    resetModuleStoresToDefault();

    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });

    addTrack({ name: 'Master', kind: 'master' });

    // Don't auto-select the master track — nothing should be selected on a fresh project
    const currentTrackState = trackStore.value;
    if (currentTrackState) {
        trackStore.set({ ...currentTrackState, selectedTrackId: null });
    }

    projectStore.set({
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
        initialized: true,
    });
    removeProjectJson();
    audioBufferCache.clear();
    clearUndoHistory();

    // Start debounced incremental auto-save for the new project.
    stopActiveAutoSave();
    setAutoSaveHandle(startCrdtAutoSave());
}
