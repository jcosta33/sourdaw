import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { type ProjectData } from '../../../models/ProjectData';
import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { projectStore } from '../../../stores/projectStore';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

export async function applyImportedProjectData(data: ProjectData): Promise<boolean> {
    // Validated — stop any in-flight playback and tear down the previous
    // project's audio graph before we hydrate stores for the imported project.
    stopPlayback();
    resetAudioGraph();

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

    // 3. Hydrate Arrangement Store
    // Note: The current ProjectData schema is single-arrangement.
    // We wrap it in a snapshot for the arrangementStore.
    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Main Arrangement',
                tracks: {
                    tracks: data.arrangement.tracks || [],
                    selectedTrackId: null,
                },
                automation: data.automation || { lanes: [] },
                midi: {
                    notesByClipId: data.arrangement.tracks.reduce(
                        (acc, t) => {
                            for (const c of t.clips) {
                                if (c.notes) {
                                    acc[c.id] = c.notes;
                                }
                            }
                            return acc;
                        },
                        {} as Record<string, any[]>
                    ),
                    ccByClipId: {},
                    pitchBendByClipId: {},
                },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });

    const ctx = getAudioContext();
    // Reconstruct audio buffers if they exist in the metadata (future proofing)
    // or fall back to IDB cache for referenced buffer IDs.
    const referencedIds = data.arrangement.tracks
        .flatMap((t) => t.clips.map((c) => c.bufferId))
        .filter((id): id is string => Boolean(id));

    await audioBufferCache.restoreFromIdb(ctx, referencedIds.length > 0 ? referencedIds : undefined);

    if (trackStore.value) {
        trackStore.set({ ...trackStore.value });
    }
    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}
