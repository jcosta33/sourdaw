import { trackStore } from '#/modules/Arrangement/stores';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { listNamedProjectJsonRecords } from '../../../repositories/project/listNamedProjectJsonRecords';
import { arrangementStore } from '../../../stores/arrangementStore';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import {
    isHydratableProjectData,
    type HydratableProjectData,
    type HydratableProjectTrack,
} from '../helpers/isHydratableProjectData';

function collectAudioBufferId(value: string | undefined, ids: Set<string>): void {
    if (value) {
        ids.add(value);
    }
}

function collectTrackBufferIds(track: HydratableProjectTrack, ids: Set<string>): void {
    collectAudioBufferId(track.frozenBufferId, ids);
    collectAudioBufferId(track.freezeState?.frozenBufferId, ids);
    for (const clip of track.clips) {
        collectAudioBufferId(clip.bufferId, ids);
    }
    for (const alternative of track.alternatives ?? []) {
        for (const clip of alternative.clips) {
            collectAudioBufferId(clip.bufferId, ids);
        }
    }
}

function collectTrackListBufferIds(tracks: readonly HydratableProjectTrack[], ids: Set<string>): void {
    for (const track of tracks) {
        collectTrackBufferIds(track, ids);
    }
}

function parseCurrentProjectSnapshot(key: string, json: string): HydratableProjectData {
    let snapshot: unknown;
    try {
        snapshot = JSON.parse(json);
    } catch (error) {
        throw new Error(`Named project record ${key} does not contain valid JSON.`, { cause: error });
    }
    if (!isHydratableProjectData(snapshot) || snapshot.version !== CURRENT_PROJECT_VERSION) {
        throw new Error(`Named project record ${key} is not a valid current-format project snapshot.`);
    }
    return snapshot;
}

function collectSnapshotBufferIds(snapshot: HydratableProjectData, ids: Set<string>): void {
    collectTrackListBufferIds(snapshot.arrangement.tracks, ids);
    for (const arrangement of snapshot.arrangements ?? []) {
        collectTrackListBufferIds(arrangement.tracks?.tracks ?? [], ids);
    }
}

type LiveAudioTrack = {
    frozenBufferId?: string;
    freezeState?: { frozenBufferId?: string };
    clips: readonly { audioBufferId?: string }[];
    alternatives?: readonly { clips: readonly { audioBufferId?: string }[] }[];
};

function collectLiveTrackBufferIds(tracks: readonly LiveAudioTrack[], ids: Set<string>): void {
    for (const track of tracks) {
        collectAudioBufferId(track.frozenBufferId, ids);
        collectAudioBufferId(track.freezeState?.frozenBufferId, ids);
        for (const clip of track.clips) {
            collectAudioBufferId(clip.audioBufferId, ids);
        }
        for (const alternative of track.alternatives ?? []) {
            for (const clip of alternative.clips) {
                collectAudioBufferId(clip.audioBufferId, ids);
            }
        }
    }
}

/**
 * Saved named owners plus all references in the open project's projections.
 * Unknown ownership rejects; a later local change invalidates admission.
 * This witness does not hold reference acquisition through IndexedDB commit
 * and cannot observe another renderer's unsaved references.
 */
export async function collectDurableOwnedAudioBufferIds(): Promise<{
    ids: readonly string[];
    isCurrent: () => boolean;
}> {
    const ids = new Set<string>();
    const records = await listNamedProjectJsonRecords();
    for (const record of records) {
        collectSnapshotBufferIds(parseCurrentProjectSnapshot(record.key, record.json), ids);
    }
    const project = projectStore.value;
    const tracks = trackStore.value;
    const arrangements = arrangementStore.value;
    const failure = projectLoadFailureStore.value;
    if (!project || project.loading || !tracks || !arrangements || failure !== null) {
        throw new Error('Open project audio ownership is unavailable while loading or after a failed load.');
    }
    const identity = captureProjectIdentity();
    const revision = captureProjectRevision();
    collectLiveTrackBufferIds(tracks.tracks, ids);
    for (const arrangement of arrangements.arrangements) {
        collectLiveTrackBufferIds(arrangement.tracks.tracks, ids);
    }
    return {
        ids: [...ids],
        isCurrent: () =>
            projectStore.value === project &&
            trackStore.value === tracks &&
            arrangementStore.value === arrangements &&
            projectLoadFailureStore.value === failure &&
            captureProjectIdentity() === identity &&
            captureProjectRevision() === revision,
    };
}
