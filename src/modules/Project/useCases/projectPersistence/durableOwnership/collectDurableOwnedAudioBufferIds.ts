import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { listNamedProjectJsonRecords } from '../../../repositories/project/listNamedProjectJsonRecords';
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

/**
 * Buffer ids referenced by every current-format named project record in
 * durable storage. Any unreadable record rejects the census so callers can
 * refuse collection rather than treat an unknown owner as absent.
 */
export async function collectDurableOwnedAudioBufferIds(): Promise<readonly string[]> {
    const ids = new Set<string>();
    const records = await listNamedProjectJsonRecords();
    for (const record of records) {
        collectSnapshotBufferIds(parseCurrentProjectSnapshot(record.key, record.json), ids);
    }
    return [...ids];
}
