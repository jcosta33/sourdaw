import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type DeferredTempoRecordingSources } from '#/utils/deferredTempoRecordingSources';
import { isRecord } from '#/utils/structuralEquality';
import { captureTempoSourceOwnerValue, type TempoSourceOwner } from '#/utils/tempoAudioSourcePromotion';

import { type TakeLane } from '../../models/TakeLane';
import { type Clip, type Track } from '../../models/Track';
import { recordingPassTiming } from '../recording/recordingPassTiming';

const sourceFields = [
    'audioBufferId',
    'assetHash',
    'fileId',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
] as const;
const takeSourceFields = [
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
] as const;

function isUncommittedRecording(clip: Clip, tracks: readonly Track[], lanes: readonly TakeLane[]): boolean {
    const timing = recordingPassTiming.ownedTakes(clip.id);
    const document = getCrdtDoc('root');
    if (
        clip.type !== 'audio' ||
        !timing?.originalTakeId ||
        !document ||
        sourceFields.some((field) => Object.hasOwn(clip, field))
    ) {
        return false;
    }
    const clips = tracks
        .flatMap((track) => [
            ...track.clips,
            ...track.alternatives
                .filter((alternative) => alternative.id !== track.activeAlternativeId)
                .flatMap((alternative) => alternative.clips),
        ])
        .filter((candidate) => candidate.id === clip.id);
    const owners = lanes.flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === clip.id).map((take) => ({ lane, take }))
    );
    return (
        clips.length === 1 &&
        owners.some(({ take }) => take.id === timing.originalTakeId) &&
        owners.every(
            ({ lane, take }) =>
                lane.trackId === clip.trackId &&
                timing.ownedTakeIds.has(take.id) &&
                !takeSourceFields.some((field) => Object.hasOwn(take, field)) &&
                !lane.activeCompRegions.some((region) => region.takeId === take.id) &&
                !lane.baseGapAudioSources?.some((tile) => tile.clipId === clip.id)
        )
    );
}

function hasForeignRawTrackOwner(rawTracks: readonly unknown[], clip: Clip, track: Track): boolean {
    let matches = 0;
    for (const rawTrack of rawTracks) {
        if (!isRecord(rawTrack) || !Array.isArray(rawTrack.clips) || !Array.isArray(rawTrack.alternatives)) {
            return true;
        }
        for (const row of rawTrack.clips) {
            if (isRecord(row) && row.id === clip.id) {
                matches++;
                if (rawTrack.id !== track.id || rawTrack.activeAlternativeId !== track.activeAlternativeId) {
                    return true;
                }
            }
        }
        for (const alternative of rawTrack.alternatives) {
            if (!isRecord(alternative) || !Array.isArray(alternative.clips)) {
                return true;
            }
            if (
                alternative.id !== rawTrack.activeAlternativeId &&
                alternative.clips.some((row) => isRecord(row) && row.id === clip.id)
            ) {
                return true;
            }
        }
    }
    if (matches > 1) {
        return true;
    }
    return false;
}

function hasForeignRawTakeOwner(
    rawLanes: readonly unknown[],
    clip: Clip,
    track: Track,
    lanes: readonly TakeLane[]
): boolean {
    const liveOwners = lanes.flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === clip.id).map((take) => ({ laneId: lane.id, takeId: take.id }))
    );
    const takeIds = new Set(liveOwners.map((owner) => owner.takeId));
    const seen = new Set<string>();
    for (const lane of rawLanes) {
        if (!isRecord(lane) || !Array.isArray(lane.takes) || !Array.isArray(lane.activeCompRegions)) {
            return true;
        }
        for (const take of lane.takes) {
            if (!isRecord(take) || typeof take.id !== 'string') {
                return true;
            }
            if (take.clipId !== clip.id && !takeIds.has(take.id)) {
                continue;
            }
            if (
                take.clipId !== clip.id ||
                lane.trackId !== track.id ||
                seen.has(take.id) ||
                !liveOwners.some((owner) => owner.takeId === take.id && owner.laneId === lane.id)
            ) {
                return true;
            }
            seen.add(take.id);
        }
        if (
            lane.activeCompRegions.some(
                (region) => isRecord(region) && typeof region.takeId === 'string' && takeIds.has(region.takeId)
            )
        ) {
            return true;
        }
        if (
            Array.isArray(lane.baseGapAudioSources) &&
            lane.baseGapAudioSources.some((tile) => isRecord(tile) && tile.clipId === clip.id)
        ) {
            return true;
        }
    }
    return false;
}

/** Capture the raw footprint separately from live pass ownership. A recording
 * may already have published its provisional rectangle, but still has no PCM basis. */
export function captureDeferredTempoRecordings(
    tracks: readonly Track[],
    lanes: readonly TakeLane[],
    document: Readonly<Record<string, unknown>> | undefined = getCrdtDoc('root')
) {
    const deferred = tracks
        .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
        .filter(({ clip }) => isUncommittedRecording(clip, tracks, lanes));
    const sources: DeferredTempoRecordingSources[number][] = [];
    const owners = deferred.map(({ clip }) => ({ id: clip.id, timing: recordingPassTiming.ownedTakes(clip.id) }));
    const clipFields = ['id', 'trackId', 'type', 'startBeat', 'endBeat', ...sourceFields];
    const takeFields = ['id', 'clipId', 'startBeat', 'endBeat', 'sourceOffsetBeats', ...takeSourceFields];
    const clipIds = new Set<string>();
    if (!document) {
        return { clipIds, sources, stillOwns: () => true };
    }
    for (const { track, clip } of deferred) {
        const rawTracks = isRecord(document.tracks) ? document.tracks.tracks : [];
        const rawTakeLanes = isRecord(document.takeLanes) ? document.takeLanes.lanes : [];
        if (
            !Array.isArray(rawTracks) ||
            !Array.isArray(rawTakeLanes) ||
            hasForeignRawTrackOwner(rawTracks, clip, track) ||
            hasForeignRawTakeOwner(rawTakeLanes, clip, track, lanes)
        ) {
            continue;
        }
        const entries: { owner: TempoSourceOwner; fields: readonly string[] }[] = [
            {
                owner: {
                    kind: 'clip',
                    trackId: track.id,
                    collection: 'active',
                    alternativeId: track.activeAlternativeId,
                    clipId: clip.id,
                },
                fields: clipFields,
            },
        ];
        const rawLanes =
            isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
        for (const lane of lanes) {
            // An unpublished lane has no raw source rows to exempt. Its identity
            // must remain absent until the synchronous commit witness recheck.
            if (!rawLanes.some((row) => isRecord(row) && row.id === lane.id && row.trackId === track.id)) {
                continue;
            }
            for (const take of lane.takes.filter((take) => take.clipId === clip.id)) {
                entries.push({
                    owner: { kind: 'take', trackId: track.id, laneId: lane.id, takeId: take.id },
                    fields: takeFields,
                });
            }
        }
        const captured = entries.map(({ owner, fields }) => ({
            owner,
            fields,
            value: captureTempoSourceOwnerValue(document, owner, fields),
            staged: captureTempoSourceOwnerValue({ tracks: { tracks }, takeLanes: { lanes } }, owner, fields),
        }));
        if (
            captured.some(
                ({ value }) =>
                    !value ||
                    (value.present &&
                        [...sourceFields, ...takeSourceFields].some((field) => Object.hasOwn(value.value, field)))
            )
        ) {
            continue;
        }
        for (const source of captured) {
            if (source.value && source.staged) {
                sources.push({ ...source, value: source.value, staged: source.staged });
            }
        }
        clipIds.add(clip.id);
    }
    return {
        clipIds,
        sources,
        stillOwns: () => owners.every(({ id, timing }) => recordingPassTiming.ownedTakes(id) === timing),
    };
}
