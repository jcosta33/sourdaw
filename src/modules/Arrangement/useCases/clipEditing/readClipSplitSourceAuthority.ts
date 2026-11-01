import { getObjectId } from '@automerge/automerge';

import { isRecord } from '#/utils/structuralEquality';

type Root = Readonly<Record<string, unknown>>;
type Scope = {
    trackId: string;
    rightClipId: string;
    clipIds: ReadonlySet<string>;
    laneIds: ReadonlySet<string>;
    takeIds: ReadonlySet<string>;
};
type TrackOwner = { id: string; kind: unknown; activeAlternativeId: unknown; clips: { id: string; locked: unknown }[] };
type ReservedClip = { trackId: unknown; alternativeId: unknown; clipId: string };
type ReservedTake = { trackId: unknown; laneId: unknown; takeId: string; clipId: unknown };

function appendReservedClips(
    track: Record<string, unknown>,
    rightClipId: string,
    objects: object[],
    reservations: ReservedClip[]
): void {
    if (!Array.isArray(track.alternatives)) {
        return;
    }
    for (const alternative of track.alternatives) {
        if (!isRecord(alternative) || !Array.isArray(alternative.clips)) {
            continue;
        }
        for (const clip of alternative.clips) {
            if (isRecord(clip) && clip.id === rightClipId) {
                objects.push(alternative, alternative.clips, clip);
                reservations.push({ trackId: track.id, alternativeId: alternative.id, clipId: rightClipId });
            }
        }
    }
}

function readTrackOwners(document: Root, scope: Scope, objects: object[]) {
    const owners: TrackOwner[] = [];
    const reservations: ReservedClip[] = [];
    const tracks: readonly unknown[] =
        isRecord(document.tracks) && Array.isArray(document.tracks.tracks) ? document.tracks.tracks : [];
    const seenTracks = new Set<string>();
    const seenClips = new Set<string>();
    for (const track of tracks) {
        if (!isRecord(track) || !Array.isArray(track.clips)) {
            if (isRecord(track) && track.id === scope.trackId) {
                return null;
            }
            continue;
        }
        const clips = track.clips.filter((clip) => isRecord(clip) && scope.clipIds.has(String(clip.id)));
        appendReservedClips(track, scope.rightClipId, objects, reservations);
        if (track.id !== scope.trackId && clips.length === 0) {
            continue;
        }
        if (typeof track.id !== 'string' || seenTracks.has(track.id)) {
            return null;
        }
        seenTracks.add(track.id);
        objects.push(track, track.clips);
        const clipOwners: TrackOwner['clips'] = [];
        for (const clip of clips) {
            if (!isRecord(clip) || typeof clip.id !== 'string' || seenClips.has(clip.id)) {
                return null;
            }
            seenClips.add(clip.id);
            objects.push(clip);
            clipOwners.push({ id: clip.id, locked: clip.locked });
        }
        owners.push({
            id: track.id,
            kind: track.kind,
            activeAlternativeId: track.activeAlternativeId,
            clips: clipOwners,
        });
    }
    return { owners, reservations };
}

function appendReservedTakes(
    lane: Record<string, unknown>,
    takeIds: ReadonlySet<string>,
    objects: object[],
    reservations: ReservedTake[]
): void {
    if (!Array.isArray(lane.takes)) {
        return;
    }
    for (const take of lane.takes) {
        if (isRecord(take) && typeof take.id === 'string' && takeIds.has(take.id)) {
            objects.push(lane, take);
            reservations.push({ trackId: lane.trackId, laneId: lane.id, takeId: take.id, clipId: take.clipId });
        }
    }
}

function appendLaneRows(lane: Record<string, unknown>, objects: object[]): boolean {
    for (const key of ['takes', 'activeCompRegions', 'baseGapAudioSources']) {
        const rows = lane[key];
        if (key === 'baseGapAudioSources' && rows === undefined) {
            continue;
        }
        if (!Array.isArray(rows)) {
            return false;
        }
        objects.push(rows);
        for (const row of rows) {
            if (!isRecord(row)) {
                return false;
            }
            objects.push(row);
            if (row.audioSource !== undefined) {
                if (!isRecord(row.audioSource)) {
                    return false;
                }
                objects.push(row.audioSource);
            }
        }
    }
    return true;
}

function readLaneReservations(document: Root, scope: Scope, objects: object[]) {
    const reservations: ReservedTake[] = [];
    const lanes: readonly unknown[] =
        isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
    const seen = new Set<string>();
    for (const lane of lanes) {
        if (!isRecord(lane)) {
            continue;
        }
        appendReservedTakes(lane, scope.takeIds, objects, reservations);
        // Every lane on the transformed track can acquire split take or base-gap ownership.
        if (lane.trackId !== scope.trackId && !scope.laneIds.has(String(lane.id))) {
            continue;
        }
        if (typeof lane.id !== 'string' || seen.has(lane.id)) {
            return null;
        }
        seen.add(lane.id);
        objects.push(lane);
        if (!appendLaneRows(lane, objects)) {
            return null;
        }
    }
    return reservations;
}

function appendClockOwners(document: Root, objects: object[]): boolean {
    if (document.transport !== undefined) {
        if (!isRecord(document.transport)) {
            return false;
        }
        objects.push(document.transport);
    }
    if (document.tempoMap !== undefined) {
        if (!isRecord(document.tempoMap) || !Array.isArray(document.tempoMap.changes)) {
            return false;
        }
        objects.push(document.tempoMap, document.tempoMap.changes);
        for (const change of document.tempoMap.changes) {
            if (!isRecord(change)) {
                return false;
            }
            objects.push(change);
        }
    }
    return true;
}

export function readClipSplitSourceAuthority(document: Root, scope: Scope) {
    const objects: object[] = [];
    const tracks = readTrackOwners(document, scope, objects);
    if (!tracks) {
        return null;
    }
    const reservedTakes = readLaneReservations(document, scope, objects);
    if (!reservedTakes || !appendClockOwners(document, objects)) {
        return null;
    }
    const identities = objects.map((object) => getObjectId(object));
    if (!identities.every((identity): identity is string => typeof identity === 'string')) {
        return null;
    }
    return { identities, trackOwners: tracks.owners, reservedClips: tracks.reservations, reservedTakes };
}
