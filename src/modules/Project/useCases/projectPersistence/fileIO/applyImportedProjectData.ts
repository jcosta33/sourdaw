import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';
import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { type ProjectData } from '../../../models/ProjectData';
import { projectStore } from '../../../stores/projectStore';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

export async function applyImportedProjectData(data: ProjectData): Promise<boolean> {
    // Validated — stop any in-flight playback and tear down the previous
    // project's audio graph before we hydrate stores for the imported project.
    stopPlayback();
    resetAudioGraph();

    hydrateModuleStoresFromProjectData(data);
    projectStore.set({
        name: data.name,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        dirty: false,
        loading: false,
        initialized: true,
    });

    if (data.arrangements && data.arrangements.length > 0 && data.activeArrangementId) {
        arrangementStore.set({
            arrangements: data.arrangements,
            activeArrangementId: data.activeArrangementId,
        });
    } else {
        arrangementStore.set({
            arrangements: [
                {
                    id: defaultArrangementId,
                    name: 'Arrangement 1',
                    tracks: data.tracks,
                    automation: data.automation,
                    midi: data.midi,
                    tempoMap: data.tempoMap,
                    timeSignatureMap: data.timeSignatureMap,
                    markers: data.markers,
                    takeLanes: data.takeLanes,
                },
            ],
            activeArrangementId: defaultArrangementId,
        });
    }

    const ctx = getAudioContext();
    if (data.audioBuffers && Object.keys(data.audioBuffers).length > 0) {
        // Self-contained file: reconstruct buffers from embedded PCM data.
        // This also writes them to IDB so they persist for future sessions.
        await audioBufferCache.importBuffers(data.audioBuffers, ctx);
    } else {
        // Legacy file (no embedded audio): fall back to the local IDB cache,
        // but load only the buffer IDs referenced by clips in this project so
        // we don't mass-load unrelated takes from previous sessions.
        const referencedIds = (data.tracks?.tracks ?? [])
            .flatMap((t) => t.clips.map((c) => c.audioBufferId))
            .filter((id): id is string => Boolean(id));
        await audioBufferCache.restoreFromIdb(ctx, referencedIds.length > 0 ? referencedIds : undefined);
    }
    if (trackStore.value) {
        trackStore.set({ ...trackStore.value });
    }
    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}
