import { getAudioContext, resetAudioGraph, restoreCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { type ProjectData } from '../../../models/ProjectData';
import { projectStore } from '../../../stores/projectStore';
import { hydrateArrangementStoreFromProjectData } from '../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

async function performImportedProjectDataApplication(data: ProjectData): Promise<boolean> {
    // Validated — stop any in-flight playback and tear down the previous
    // project's audio graph before we hydrate stores for the imported project.
    stopPlayback();
    resetAudioGraph();

    // Reset per-device-instance stores (§13.1) so stale device state from the
    // previously open project does not remain interactive while buffers load;
    // hydrateModuleStoresFromProjectData does not touch the device stores.
    resetModuleStoresToDefault();

    // Restore referenced runtime buffers before publishing the imported track
    // graph. Track subscribers can render waveforms from their first update,
    // without a synthetic track-store write after hydration.
    const referencedIds = data.arrangement.tracks
        .flatMap((track) => [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)])
        .map((clip) => clip.bufferId)
        .filter((id): id is string => Boolean(id));
    await restoreCachedAudioBuffersFromIdb({
        audioContext: getAudioContext(),
        bufferIds: referencedIds.length > 0 ? referencedIds : undefined,
    });

    // 1. Hydrate core module stores
    hydrateModuleStoresFromProjectData(data);

    // 2. Hydrate Project Store (Meta & Tuning)
    projectStore.set({
        name: data.meta.name,
        createdAt: data.meta.createdAt,
        updatedAt: data.meta.updatedAt,
        keyRoot: data.meta.keyRoot,
        scaleName: data.meta.scaleName,
        tuning: data.meta.tuning,
        dirty: false,
        loading: false,
        initialized: true,
    });

    // The current schema still collapses imported projects to one arrangement;
    // the Project owner publishes that snapshot from the same hydrated tracks.
    hydrateArrangementStoreFromProjectData(data);

    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}

export function applyImportedProjectData(data: ProjectData): Promise<boolean> {
    return runProjectLoadTransaction({
        load: () => performImportedProjectDataApplication(data),
    });
}
