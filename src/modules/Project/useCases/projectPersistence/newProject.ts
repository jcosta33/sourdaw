import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { projectStore } from '../../stores/projectStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { setSidechainRoutes } from '#/modules/Routing/useCases/sidechain';
import { removeProjectJson } from '../../repositories/project';
import { addTrack as addTrackUseCase } from '#/modules/Arrangement/useCases/addTrack';
import { clearUndoHistory } from './helpers';

export function newProject(name = 'Untitled Project'): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    transportStore.set(defaultTransportState);
    automationStore.set({ lanes: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
    setSidechainRoutes([]);

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

    addTrackUseCase({ name: 'Master', kind: 'master' });

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
    });
    removeProjectJson();
    audioBufferCache.clear();
    clearUndoHistory();
}
