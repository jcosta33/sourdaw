import { getAudioContext, resetAudioGraph, restoreCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { type ProjectData } from '../../../models/ProjectData';
import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';
import { projectStore } from '../../../stores/projectStore';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

import { hydrateProjectMidi } from './hydrateProjectMidi';

export async function applyImportedProjectData(data: ProjectData): Promise<boolean> {
    // Validated — stop any in-flight playback and tear down the previous
    // project's audio graph before we hydrate stores for the imported project.
    stopPlayback();
    resetAudioGraph();

    // Restore referenced runtime buffers before publishing the imported track
    // graph. Track subscribers can render waveforms from their first update,
    // without a synthetic track-store write after hydration.
    const referencedIds = data.arrangement.tracks
        .flatMap((track) => track.clips.map((clip) => clip.bufferId))
        .filter((id): id is string => Boolean(id));
    await restoreCachedAudioBuffersFromIdb({
        audioContext: getAudioContext(),
        bufferIds: referencedIds.length > 0 ? referencedIds : undefined,
    });

    // Reset per-device-instance stores (§13.1) so stale device state from the
    // previously open project does not leak into the imported project;
    // hydrateModuleStoresFromProjectData does not touch the device stores.
    resetModuleStoresToDefault();

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
                name: 'Arrangement 1',
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

    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}
