import { inject } from '#/infra/di/inject';
import { addTrack, trackStore } from '#/modules/Arrangement';
import { audioBufferCache, resetAudioGraph } from '#/modules/AudioEngine';
import { createCrdtProject, startCrdtAutoSave } from '#/modules/CrdtDocument';
import { stopPlayback } from '#/modules/Command';

import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { projectStore } from '../../stores/projectStore';
import { removeProjectJson } from '../../repositories/project/storageOperations';
import { clearUndoHistory, resetModuleStoresToDefault } from './helpers';

let stopAutoSave: (() => void) | null = null;

export const newProject = inject({
    stopPlayback,
    resetAudioGraph,
    createCrdtProject,
    resetModuleStoresToDefault,
    addTrack,
    clearUndoHistory,
    startCrdtAutoSave,
    removeProjectJson,
})(
    ({
        stopPlayback,
        resetAudioGraph,
        createCrdtProject,
        resetModuleStoresToDefault,
        addTrack,
        clearUndoHistory,
        startCrdtAutoSave,
        removeProjectJson,
    }) =>
        function newProject(name = 'Untitled Project'): void {
            // Stop any in-flight playback and tear down the previous project's audio
            // graph before we start mutating stores for the new project.
            stopPlayback();
            resetAudioGraph();

            // 1. Initialize CRDT Document structure so subsequent .set() calls persist
            createCrdtProject(name).catch((error) => {
                console.error('[newProject] Failed to initialize CRDT structure:', error);
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
            if (stopAutoSave) {
                stopAutoSave();
            }
            stopAutoSave = startCrdtAutoSave();
        }
);
