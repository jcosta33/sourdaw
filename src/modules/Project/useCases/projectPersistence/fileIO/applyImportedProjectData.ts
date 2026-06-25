import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { type ProjectData } from '../../../models/ProjectData';
import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { projectStore } from '../../../stores/projectStore';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

import { hydrateProjectMidi } from './midiStateMapping';

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
    // Note: The current ProjectData schema collapses to a single arrangement on
    // import (multi-arrangement reconstruction is deferred — see the inventory
    // decisions backlog). We wrap the imported arrangement in one snapshot.
    const arrangementMidi = data.midi
        ? hydrateProjectMidi(data.midi)
        : { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

    // Older exports (and the inline copy alongside the top-level map) fold each
    // clip's notes onto the clip itself; fill any clip the top-level map missed.
    for (const track of data.arrangement.tracks) {
        for (const clip of track.clips) {
            if (!arrangementMidi.notesByClipId[clip.id] && clip.notes && clip.notes.length > 0) {
                arrangementMidi.notesByClipId[clip.id] = clip.notes;
            }
        }
    }

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
                midi: arrangementMidi,
            },
        ],
        activeArrangementId: defaultArrangementId,
    });

    const ctx = getAudioContext();
    // Reconstruct audio buffers if they exist in the metadata (future proofing)
    // or fall back to IDB cache for referenced buffer IDs.
    const referencedIds = data.arrangement.tracks
        .flatMap((time) => time.clips.map((context) => context.bufferId))
        .filter((id): id is string => Boolean(id));

    await audioBufferCache.restoreFromIdb(ctx, referencedIds.length > 0 ? referencedIds : undefined);

    if (trackStore.value) {
        trackStore.set({ ...trackStore.value });
    }
    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}
