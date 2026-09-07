import { readNamedProjectJson } from '../../../repositories/project/readNamedProjectJson';
import { getRecentProjects } from '../../recentProjects/helpers';
import { normalizeLegacyProjectData } from '../helpers/normalizeLegacyProjectData';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectAudioBufferId(value: unknown, ids: Set<string>): void {
    if (typeof value === 'string' && value.length > 0) {
        ids.add(value);
    }
}

function collectClipBufferIds(clips: unknown, ids: Set<string>): void {
    if (!Array.isArray(clips)) {
        return;
    }
    for (const clip of clips) {
        if (!isRecord(clip)) {
            continue;
        }
        // The serialized clip names its sample `bufferId`; snapshots written
        // before the serializer mapped the runtime fields carry `audioBufferId`.
        collectAudioBufferId(clip.bufferId, ids);
        collectAudioBufferId(clip.audioBufferId, ids);
    }
}

function collectTrackBufferIds(track: unknown, ids: Set<string>): void {
    if (!isRecord(track)) {
        return;
    }
    collectAudioBufferId(track.frozenBufferId, ids);
    if (isRecord(track.freezeState)) {
        collectAudioBufferId(track.freezeState.frozenBufferId, ids);
    }
    collectClipBufferIds(track.clips, ids);
    if (!Array.isArray(track.alternatives)) {
        return;
    }
    for (const alternative of track.alternatives) {
        if (isRecord(alternative)) {
            collectClipBufferIds(alternative.clips, ids);
        }
    }
}

function collectTrackListBufferIds(tracks: unknown, ids: Set<string>): void {
    if (!Array.isArray(tracks)) {
        return;
    }
    for (const track of tracks) {
        collectTrackBufferIds(track, ids);
    }
}

/** Buffer ids one persisted snapshot references, read from the exact sections
 * `buildProjectData` writes them to. The snapshot arrives already run through
 * `normalizeLegacyProjectData`, the same interpreter every loader uses, so
 * supported v1 shapes (flat, top-level tracks) read exactly as they do on
 * load. A snapshot that still has no arrangement section cannot be
 * interpreted, and collecting nothing from it would expose its audio to
 * collection — so it fails the enumeration, which the collector answers by
 * deleting nothing. */
function collectSnapshotBufferIds(snapshot: unknown, ids: Set<string>): void {
    if (!isRecord(snapshot) || !isRecord(snapshot.arrangement) || !Array.isArray(snapshot.arrangement.tracks)) {
        throw new Error('Persisted project snapshot is missing its arrangement tracks.');
    }
    collectTrackListBufferIds(snapshot.arrangement.tracks, ids);
    if (Array.isArray(snapshot.arrangements)) {
        for (const stored of snapshot.arrangements) {
            if (isRecord(stored) && isRecord(stored.tracks)) {
                collectTrackListBufferIds(stored.tracks.tracks, ids);
            }
        }
    }
    if (isRecord(snapshot.audioBuffers)) {
        for (const id of Object.keys(snapshot.audioBuffers)) {
            collectAudioBufferId(id, ids);
        }
    }
}

/**
 * Buffer ids durably owned by ALL saved named projects — the active one and
 * every inactive one — enumerated from the persisted snapshots at call time.
 * The snapshots are the same records the Recent Projects list and
 * `loadRecentProject` read, so the enumeration can never drift from what the
 * projects actually reference: a removed or superseded record stops
 * contributing its ids on the next call, and an id shared by several projects
 * stays owned while any one of them remains.
 */
export async function collectDurableOwnedAudioBufferIds(): Promise<readonly string[]> {
    const ids = new Set<string>();
    for (const entry of getRecentProjects()) {
        const raw = await readNamedProjectJson(entry.key);
        if (raw === null) {
            continue;
        }
        collectSnapshotBufferIds(normalizeLegacyProjectData(JSON.parse(raw)), ids);
    }
    return [...ids];
}
