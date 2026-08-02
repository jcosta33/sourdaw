import {
    adjustmentLayerStore,
    markerStore,
    takeLaneStore,
    trackStore,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import { exportCachedAudioBuffers } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    chordTrackStore,
    defaultChordTrackState,
    defaultGrooveTemplateState,
    grooveTemplateStore,
    midiStore,
} from '#/modules/MIDI/stores';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { yeastStore } from '#/modules/Yeast/stores';

import {
    CURRENT_PROJECT_VERSION,
    type ProjectData,
    type ProjectExportedAudioBuffer,
} from '../../../models/ProjectData';
import { arrangementStore } from '../../../stores/arrangementStore';
import { projectStore } from '../../../stores/projectStore';
import { syncCurrentArrangementToStore } from '../../arrangement/syncCurrentArrangementToStore';

import { serializeArrangementTracks } from './serializeArrangementTracks';
import { serializeProjectGrooves } from './serializeProjectGrooves';
import { serializeProjectMidi } from './serializeProjectMidi';

/** Collect every audioBufferId (clips + frozen buffers + track alternatives)
 * referenced by a TrackStoreState so the export can embed the raw PCM. */
function collectBufferIds(trackState: TrackStoreState | null | undefined): Set<string> {
    const ids = new Set<string>();
    for (const track of trackState?.tracks ?? []) {
        if (track.freezeState.frozenBufferId) {
            ids.add(track.freezeState.frozenBufferId);
        }
        for (const clip of track.clips) {
            if (clip.audioBufferId) {
                ids.add(clip.audioBufferId);
            }
        }
        for (const alt of track.alternatives) {
            for (const clip of alt.clips) {
                if (clip.audioBufferId) {
                    ids.add(clip.audioBufferId);
                }
            }
        }
    }
    return ids;
}

/** Result of serializing the live project: the `ProjectData` snapshot plus the
 * count of referenced audio buffers that could not be embedded (so the export
 * UX can warn the user; the in-app save snapshot ignores it). */
export type BuiltProjectData = {
    data: ProjectData;
    missingBufferCount: number;
};

type BuildProjectDataInput = {
    /**
     * Embed base64 PCM for every referenced buffer. **Opt-in**, because it is
     * ruinous by default: measured at 420 ms per minute of stereo on the main
     * thread, and `JSON.stringify` throws outright past roughly 17.5 minutes of
     * it (V8's 536,870,888-character ceiling, which is the string type rather
     * than any quota).
     *
     * Only the explicit user-initiated `.sourdaw` export passes `true`. Every
     * live path leaves it off and relies on the raw `Float32Array` copy the
     * audio cache already holds in IndexedDB — the base64 layer existed solely
     * to survive JSON. The snapshot shape is unchanged either way;
     * `audioBuffers` simply stays unset.
     */
    includeAudioBuffers?: boolean;
};

/**
 * Serialize the live module stores into the canonical {@link ProjectData}
 * snapshot — the single source of truth for the `.sourdaw` export *and* the
 * per-project flat-JSON save snapshot the recent-projects read path consumes.
 *
 * Both `exportProjectFile` and `saveProject` call this so the two never drift:
 * the snapshot is exactly the shape `hydrateModuleStoresFromProjectData`
 * consumes. Returns `null` when a required store is unpopulated (no live
 * project), so callers can no-op rather than write a malformed blob.
 */
export async function buildProjectData({
    includeAudioBuffers = false,
}: BuildProjectDataInput = {}): Promise<BuiltProjectData | null> {
    syncCurrentArrangementToStore();

    const tracks = trackStore.value;
    const transport = transportStore.value;
    const automation = automationStore.value;
    const midi = midiStore.value;
    const project = projectStore.value;
    const arrState = arrangementStore.value;
    const yeastState = yeastStore.value;

    if (!tracks || !transport || !automation || !midi || !project || !arrState) {
        return null;
    }

    // Collect all audioBufferIds referenced by the project (current track state
    // and every arrangement, including non-active ones).
    const allBufferIds = new Set<string>();
    for (const id of collectBufferIds(tracks)) {
        allBufferIds.add(id);
    }
    for (const arr of arrState.arrangements) {
        for (const id of collectBufferIds(arr.tracks)) {
            allBufferIds.add(id);
        }
    }
    const audioBuffers: Record<string, ProjectExportedAudioBuffer> = includeAudioBuffers
        ? await exportCachedAudioBuffers({ bufferIds: [...allBufferIds] })
        : {};

    const resolvedIds = new Set(Object.keys(audioBuffers));
    const missingBufferCount = includeAudioBuffers ? [...allBufferIds].filter((id) => !resolvedIds.has(id)).length : 0;
    let yeast: ProjectData['yeast'];
    if (yeastState && yeastState.processors.length > 0) {
        yeast = {
            processors: structuredClone(yeastState.processors),
        };
    }

    const data: ProjectData = {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: Date.now(),
            keyRoot: project.keyRoot,
            scaleName: project.scaleName,
            tuning: project.tuning,
        },
        transport: {
            tempo: transport.tempo,
            timeSignatureNumerator: transport.timeSignatureNumerator,
            timeSignatureDenominator: transport.timeSignatureDenominator,
            loopStart: transport.loopStart,
            loopEnd: transport.loopEnd,
            isLooping: transport.isLooping,
            metronomeEnabled: transport.metronomeEnabled,
            metronomeVolume: transport.metronomeVolume,
            punchInEnabled: transport.punchInEnabled,
            punchInBeat: transport.punchInBeat,
            punchOutBeat: transport.punchOutBeat,
            countInEnabled: transport.countInEnabled,
            countInBars: transport.countInBars,
            preRollEnabled: transport.preRollEnabled,
            preRollBars: transport.preRollBars,
            masterGain: transport.masterGain,
        },
        arrangement: {
            // Map runtime arrangement clips (audioBufferId/audioOffsetBeats) onto
            // the serialized clip shape (bufferId/sampleStartBeat) and fold each
            // clip's MIDI notes inline from the MIDI store, so the import side's
            // bufferId lookup resolves and notes survive the round-trip.
            tracks: serializeArrangementTracks(tracks.tracks, midi.notesByClipId),
        },
        automation,
        mixer: {
            master: { gain: 0.8, pan: 0 },
            buses: [],
        },
        midi: serializeProjectMidi(midi),
        chordTrack: structuredClone(chordTrackStore.value ?? defaultChordTrackState),
        grooves: serializeProjectGrooves(grooveTemplateStore.value ?? defaultGrooveTemplateState),
        yeast,
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: (markerStore.value?.markers || []).map((message) => ({
            id: message.id,
            beat: message.beat,
            name: message.name || (message as { label?: string }).label || 'Untitled',
            color: message.color,
        })),
        takeLanes: takeLaneStore.value ?? undefined,
        sidechainRoutes: getAllSidechainRoutes(),
        arrangements: arrState.arrangements.map((snapshot) => ({
            ...snapshot,
            tracks: {
                ...snapshot.tracks,
                tracks: serializeArrangementTracks(snapshot.tracks.tracks, snapshot.midi.notesByClipId),
            },
            midi: serializeProjectMidi({
                notesByClipId: snapshot.midi.notesByClipId,
                ccByClipId: snapshot.midi.ccByClipId,
                pitchBendByClipId: snapshot.midi.pitchBendByClipId,
            }),
        })),
        activeArrangementId: arrState.activeArrangementId,
        audioBuffers: Object.keys(audioBuffers).length > 0 ? audioBuffers : undefined,
        adjustmentLayers: { layers: adjustmentLayerStore.value?.layers ?? [] },
        history: { checkpoints: [] },
    };

    return { data, missingBufferCount };
}
