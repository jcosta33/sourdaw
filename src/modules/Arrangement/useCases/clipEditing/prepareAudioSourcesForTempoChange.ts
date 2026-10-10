import { readTempoAtBeat } from '#/modules/Transport/stores';
import { resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import { type HandlerValidationContext, type TempoAudioSourceTransition } from '#/utils/handlerContract';

import { type Take, type TakeLane } from '../../models/TakeLane';
import { type Clip, type Track } from '../../models/Track';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';

import { isTempoAudioSourceTransition } from './isTempoAudioSourceTransition';
import { projectClipReplayPrefix } from './projectClipReplayPrefix';

type ClipSource = TempoAudioSourceTransition['clips'][number];
type TakeSource = TempoAudioSourceTransition['takes'][number];
type ClipLocation = { track: Track; alternativeId: string | null; clip: Clip };

type ProjectedClip = NonNullable<ReturnType<typeof projectClipReplayPrefix>>['clips'][number]['clip'];

function projectedSourceFieldsAreValid(clip: ProjectedClip): boolean {
    return (
        (clip.audioBufferId === undefined || typeof clip.audioBufferId === 'string') &&
        (clip.fileId === undefined || typeof clip.fileId === 'string') &&
        (clip.assetHash === undefined || typeof clip.assetHash === 'string') &&
        (!Object.hasOwn(clip, 'audioOffsetBeats') ||
            (typeof clip.audioOffsetBeats === 'number' && Number.isFinite(clip.audioOffsetBeats))) &&
        (!Object.hasOwn(clip, 'audioOffsetSeconds') ||
            (typeof clip.audioOffsetSeconds === 'number' && Number.isFinite(clip.audioOffsetSeconds)))
    );
}

function isCompleteProjectedClip(clip: ProjectedClip, trackId: string): clip is Clip {
    return (
        typeof clip.id === 'string' &&
        clip.id.length > 0 &&
        clip.trackId === trackId &&
        typeof clip.name === 'string' &&
        Number.isFinite(clip.startBeat) &&
        Number.isFinite(clip.endBeat) &&
        clip.endBeat > clip.startBeat &&
        (clip.type === 'audio' || clip.type === 'midi') &&
        typeof clip.fadeInBeats === 'number' &&
        Number.isFinite(clip.fadeInBeats) &&
        typeof clip.fadeOutBeats === 'number' &&
        Number.isFinite(clip.fadeOutBeats) &&
        typeof clip.gain === 'number' &&
        Number.isFinite(clip.gain) &&
        typeof clip.color === 'string' &&
        typeof clip.locked === 'boolean' &&
        typeof clip.muted === 'boolean' &&
        projectedSourceFieldsAreValid(clip)
    );
}

function ownedClipForTake(locations: readonly ClipLocation[], trackId: string, clipId: string): ClipLocation | null {
    const active = locations.find(
        (location) => location.track.id === trackId && location.alternativeId === null && location.clip.id === clipId
    );
    if (active) {
        return active;
    }
    const alternatives = locations.filter((location) => location.track.id === trackId && location.clip.id === clipId);
    return alternatives.length === 1 ? alternatives[0]! : null;
}

export type PreparedTempoAudioSources = {
    transition: TempoAudioSourceTransition;
    matches: () => boolean;
    apply: () => boolean;
};

function allClipLocations(tracks: readonly Track[]): ClipLocation[] | null {
    const locations: ClipLocation[] = [];
    const trackIds = new Set<string>();
    for (const track of tracks) {
        if (trackIds.has(track.id)) {
            return null;
        }
        trackIds.add(track.id);
        const alternativeIds = new Set<string>();
        for (const alternative of track.alternatives) {
            if (alternativeIds.has(alternative.id)) {
                return null;
            }
            alternativeIds.add(alternative.id);
        }
        for (const [alternativeId, clips] of [
            [null, track.clips],
            ...track.alternatives.map((alternative) => [alternative.id, alternative.clips] as const),
        ] as const) {
            const clipIds = new Set<string>();
            for (const clip of clips) {
                if (clipIds.has(clip.id)) {
                    return null;
                }
                clipIds.add(clip.id);
                locations.push({ track, alternativeId, clip });
            }
        }
    }
    return locations;
}

function captureClipSource(
    location: ClipLocation,
    nextTempoAtBeat: (beat: number) => number
): ClipSource | null | undefined {
    const { clip, track, alternativeId } = location;
    if (
        clip.type !== 'audio' ||
        Object.hasOwn(clip, 'audioOffsetSeconds') ||
        !Object.hasOwn(clip, 'audioOffsetBeats')
    ) {
        return undefined;
    }
    const originalTempo = readTempoAtBeat({ beat: clip.startBeat });
    if (Object.is(originalTempo, nextTempoAtBeat(clip.startBeat))) {
        return undefined;
    }
    const audioOffsetBeats = clip.audioOffsetBeats;
    const audioOffsetSeconds = resolveAudioSourceOffsetSeconds(clip, originalTempo);
    if (
        audioOffsetBeats === undefined ||
        !Number.isFinite(audioOffsetBeats) ||
        !Number.isFinite(audioOffsetSeconds) ||
        !Number.isFinite(originalTempo) ||
        originalTempo <= 0
    ) {
        return null;
    }
    return {
        trackId: track.id,
        alternativeId,
        clipId: clip.id,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        audioBufferId: clip.audioBufferId ?? null,
        fileId: clip.fileId ?? null,
        assetHash: clip.assetHash ?? null,
        originalTempo,
        audioOffsetBeats,
        audioOffsetSeconds,
    };
}

function captureTakeSource(
    lane: TakeLane,
    take: Take,
    locations: readonly ClipLocation[],
    nextTempoAtBeat: (beat: number) => number
): TakeSource | null | undefined {
    if (Object.hasOwn(take, 'sourceOffsetSeconds') || !Object.hasOwn(take, 'sourceOffsetBeats')) {
        return undefined;
    }
    const sourceClip = ownedClipForTake(locations, lane.trackId, take.clipId);
    if (!sourceClip || sourceClip.clip.type !== 'audio') {
        return undefined;
    }
    const originalTempo = readTempoAtBeat({ beat: sourceClip.clip.startBeat });
    if (Object.is(originalTempo, nextTempoAtBeat(sourceClip.clip.startBeat))) {
        return undefined;
    }
    const sourceOffsetBeats = take.sourceOffsetBeats;
    const sourceOffsetSeconds = resolveAudioSourceOffsetSeconds({ audioOffsetBeats: sourceOffsetBeats }, originalTempo);
    if (sourceOffsetBeats === undefined || !Number.isFinite(sourceOffsetSeconds)) {
        return null;
    }
    return {
        laneId: lane.id,
        trackId: lane.trackId,
        takeId: take.id,
        clipId: take.clipId,
        alternativeId: sourceClip.alternativeId,
        clipStartBeat: sourceClip.clip.startBeat,
        clipEndBeat: sourceClip.clip.endBeat,
        audioBufferId: sourceClip.clip.audioBufferId ?? null,
        fileId: sourceClip.clip.fileId ?? null,
        assetHash: sourceClip.clip.assetHash ?? null,
        startBeat: take.startBeat,
        endBeat: take.endBeat,
        originalTempo,
        sourceOffsetBeats,
        sourceOffsetSeconds,
    };
}

function findClip(tracks: readonly Track[], source: ClipSource): Clip | null {
    const track = tracks.find((candidate) => candidate.id === source.trackId);
    if (!track) {
        return null;
    }
    let clips = track.clips;
    if (source.alternativeId !== null) {
        clips = track.alternatives.find((alternative) => alternative.id === source.alternativeId)?.clips ?? [];
    }
    const matches = clips?.filter((clip) => clip.id === source.clipId) ?? [];
    return matches.length === 1 ? matches[0]! : null;
}

function sourceMatches(clip: Clip, source: ClipSource, direction: TempoAudioSourceTransition['direction']): boolean {
    if (direction === 'apply' && Object.hasOwn(clip, 'audioOffsetSeconds')) {
        return false;
    }
    if (
        direction === 'restore' &&
        (!Object.hasOwn(clip, 'audioOffsetSeconds') || !Object.is(clip.audioOffsetSeconds, source.audioOffsetSeconds))
    ) {
        return false;
    }
    return (
        clip.type === 'audio' &&
        clip.trackId === source.trackId &&
        clip.startBeat === source.startBeat &&
        clip.endBeat === source.endBeat &&
        (clip.audioBufferId ?? null) === source.audioBufferId &&
        (clip.fileId ?? null) === source.fileId &&
        (clip.assetHash ?? null) === source.assetHash &&
        Object.hasOwn(clip, 'audioOffsetBeats') &&
        Object.is(clip.audioOffsetBeats, source.audioOffsetBeats)
    );
}

function takeMatches(take: Take, source: TakeSource, direction: TempoAudioSourceTransition['direction']): boolean {
    if (direction === 'apply' && Object.hasOwn(take, 'sourceOffsetSeconds')) {
        return false;
    }
    if (
        direction === 'restore' &&
        (!Object.hasOwn(take, 'sourceOffsetSeconds') ||
            !Object.is(take.sourceOffsetSeconds, source.sourceOffsetSeconds))
    ) {
        return false;
    }
    return (
        take.clipId === source.clipId &&
        take.startBeat === source.startBeat &&
        take.endBeat === source.endBeat &&
        Object.hasOwn(take, 'sourceOffsetBeats') &&
        Object.is(take.sourceOffsetBeats, source.sourceOffsetBeats)
    );
}

function withClipSource(clip: Clip, source: ClipSource, direction: TempoAudioSourceTransition['direction']): Clip {
    if (direction === 'apply') {
        return { ...clip, audioOffsetSeconds: source.audioOffsetSeconds };
    }
    const { audioOffsetSeconds: _removed, ...restored } = clip;
    return restored;
}

function withTakeSource(take: Take, source: TakeSource, direction: TempoAudioSourceTransition['direction']): Take {
    if (direction === 'apply') {
        return { ...take, sourceOffsetSeconds: source.sourceOffsetSeconds };
    }
    const { sourceOffsetSeconds: _removed, ...restored } = take;
    return restored;
}

type TempoSourceInput = {
    nextTempoAtBeat: (beat: number) => number;
    replay?: TempoAudioSourceTransition;
    context?: HandlerValidationContext;
};

function captureTransition(
    locations: readonly ClipLocation[],
    lanes: readonly TakeLane[],
    nextTempoAtBeat: (beat: number) => number
): TempoAudioSourceTransition | null {
    const clips: ClipSource[] = [];
    const takes: TakeSource[] = [];
    for (const location of locations) {
        const source = captureClipSource(location, nextTempoAtBeat);
        if (source === null) {
            return null;
        }
        if (source) {
            clips.push(source);
        }
    }
    for (const lane of lanes) {
        for (const take of lane.takes) {
            const source = captureTakeSource(lane, take, locations, nextTempoAtBeat);
            if (source === null) {
                return null;
            }
            if (source) {
                takes.push(source);
            }
        }
    }
    return { version: 1, direction: 'apply', clips, takes };
}

function replayCoversNewLegacySources(
    locations: readonly ClipLocation[],
    lanes: readonly TakeLane[],
    transition: TempoAudioSourceTransition,
    nextTempoAtBeat: (beat: number) => number
): boolean {
    for (const location of locations) {
        const source = captureClipSource(location, nextTempoAtBeat);
        if (
            source === null ||
            (source &&
                !transition.clips.some(
                    (captured) =>
                        captured.trackId === source.trackId &&
                        captured.alternativeId === source.alternativeId &&
                        captured.clipId === source.clipId
                ))
        ) {
            return false;
        }
    }
    for (const lane of lanes) {
        for (const take of lane.takes) {
            const source = captureTakeSource(lane, take, locations, nextTempoAtBeat);
            if (
                source === null ||
                (source &&
                    !transition.takes.some(
                        (captured) => captured.laneId === source.laneId && captured.takeId === source.takeId
                    ))
            ) {
                return false;
            }
        }
    }
    return true;
}

function clipTempoReferenceMatches(
    source: ClipSource,
    transition: TempoAudioSourceTransition,
    nextTempoAtBeat: (beat: number) => number
): boolean {
    const currentTempo = readTempoAtBeat({ beat: source.startBeat });
    const nextTempo = nextTempoAtBeat(source.startBeat);
    const governingTempo = transition.direction === 'restore' ? nextTempo : currentTempo;
    return Object.is(governingTempo, source.originalTempo) && !Object.is(currentTempo, nextTempo);
}

function takeTempoReferenceMatches(
    source: TakeSource,
    locations: readonly ClipLocation[],
    lanes: readonly TakeLane[],
    transition: TempoAudioSourceTransition,
    nextTempoAtBeat: (beat: number) => number
): boolean {
    const lane = lanes.find((candidate) => candidate.id === source.laneId);
    const location = lane ? ownedClipForTake(locations, lane.trackId, source.clipId) : null;
    if (
        !location ||
        location.clip.type !== 'audio' ||
        lane?.trackId !== source.trackId ||
        location.alternativeId !== source.alternativeId ||
        location.clip.startBeat !== source.clipStartBeat ||
        location.clip.endBeat !== source.clipEndBeat ||
        (location.clip.audioBufferId ?? null) !== source.audioBufferId ||
        (location.clip.fileId ?? null) !== source.fileId ||
        (location.clip.assetHash ?? null) !== source.assetHash
    ) {
        return false;
    }
    const currentTempo = readTempoAtBeat({ beat: location.clip.startBeat });
    const nextTempo = nextTempoAtBeat(location.clip.startBeat);
    const governingTempo = transition.direction === 'restore' ? nextTempo : currentTempo;
    return Object.is(governingTempo, source.originalTempo) && !Object.is(currentTempo, nextTempo);
}

function takeSourceStateMatches(
    source: TakeSource,
    locations: readonly ClipLocation[],
    lanes: readonly TakeLane[],
    direction: TempoAudioSourceTransition['direction']
): boolean {
    const matchingLanes = lanes.filter((candidate) => candidate.id === source.laneId);
    if (matchingLanes.length !== 1) {
        return false;
    }
    const lane = matchingLanes[0]!;
    const matchingTakes = lane.takes.filter((candidate) => candidate.id === source.takeId);
    if (matchingTakes.length !== 1) {
        return false;
    }
    const take = matchingTakes[0]!;
    const location = ownedClipForTake(locations, source.trackId, source.clipId);
    return Boolean(
        lane &&
        lane.trackId === source.trackId &&
        take &&
        location &&
        location.alternativeId === source.alternativeId &&
        location.clip.startBeat === source.clipStartBeat &&
        location.clip.endBeat === source.clipEndBeat &&
        (location.clip.audioBufferId ?? null) === source.audioBufferId &&
        (location.clip.fileId ?? null) === source.fileId &&
        (location.clip.assetHash ?? null) === source.assetHash &&
        takeMatches(take, source, direction)
    );
}

function sourceStateMatches(
    transition: TempoAudioSourceTransition,
    currentTracks = trackStore.value,
    currentLanes = takeLaneStore.value
): boolean {
    if (!currentTracks || !currentLanes) {
        return false;
    }
    const locations = allClipLocations(currentTracks.tracks);
    if (!locations) {
        return false;
    }
    for (const source of transition.clips) {
        const clip = findClip(currentTracks.tracks, source);
        if (!clip || !sourceMatches(clip, source, transition.direction)) {
            return false;
        }
    }
    for (const source of transition.takes) {
        if (!takeSourceStateMatches(source, locations, currentLanes.lanes, transition.direction)) {
            return false;
        }
    }
    return true;
}

function applyTransition(transition: TempoAudioSourceTransition): void {
    const currentTracks = trackStore.value!;
    const currentLanes = takeLaneStore.value!;
    if (transition.clips.length > 0) {
        trackStore.set({
            ...currentTracks,
            tracks: currentTracks.tracks.map((track) => {
                const sources = transition.clips.filter((source) => source.trackId === track.id);
                if (sources.length === 0) {
                    return track;
                }
                return {
                    ...track,
                    clips: track.clips.map((clip) => {
                        const source = sources.find(
                            (candidate) => candidate.alternativeId === null && candidate.clipId === clip.id
                        );
                        return source ? withClipSource(clip, source, transition.direction) : clip;
                    }),
                    alternatives: track.alternatives.map((alternative) => ({
                        ...alternative,
                        clips: alternative.clips.map((clip) => {
                            const source = sources.find(
                                (candidate) =>
                                    candidate.alternativeId === alternative.id && candidate.clipId === clip.id
                            );
                            return source ? withClipSource(clip, source, transition.direction) : clip;
                        }),
                    })),
                };
            }),
        });
    }
    if (transition.takes.length > 0) {
        takeLaneStore.set({
            ...currentLanes,
            lanes: currentLanes.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) => {
                    const source = transition.takes.find(
                        (candidate) => candidate.laneId === lane.id && candidate.takeId === take.id
                    );
                    return source ? withTakeSource(take, source, transition.direction) : take;
                }),
            })),
        });
    }
}

export function prepareAudioSourcesForTempoChange(input: TempoSourceInput): PreparedTempoAudioSources | null {
    let tracks = trackStore.value;
    const lanes = takeLaneStore.value;
    if (!tracks || !lanes) {
        return null;
    }
    const priorActions = input.context?.actions.slice(0, input.context.actionIndex) ?? [];
    if (priorActions.length > 0) {
        const projected = projectClipReplayPrefix(priorActions);
        if (!projected) {
            return null;
        }
        // Membership and order belong to the prefix too: a prior restore can
        // supply the source a later tempo inverse must guard before it exists live.
        // Hidden alternatives and take ownership keep their original peer guards.
        const projectedTracks: Track[] = [];
        for (const track of tracks.tracks) {
            const clips: Clip[] = [];
            for (const owner of projected.clips.filter((candidate) => candidate.owningTrackId === track.id)) {
                if (!isCompleteProjectedClip(owner.clip, track.id)) {
                    return null;
                }
                clips.push(owner.clip);
            }
            projectedTracks.push({ ...track, clips });
        }
        tracks = { ...tracks, tracks: projectedTracks };
    }
    const locations = allClipLocations(tracks.tracks);
    if (!locations) {
        return null;
    }
    const transition = input.replay ?? captureTransition(locations, lanes.lanes, input.nextTempoAtBeat);
    if (!isTempoAudioSourceTransition(transition)) {
        return null;
    }
    if (input.replay && !replayCoversNewLegacySources(locations, lanes.lanes, transition, input.nextTempoAtBeat)) {
        return null;
    }
    if (
        !transition.clips.every((source) => clipTempoReferenceMatches(source, transition, input.nextTempoAtBeat)) ||
        !transition.takes.every((source) =>
            takeTempoReferenceMatches(source, locations, lanes.lanes, transition, input.nextTempoAtBeat)
        ) ||
        !sourceStateMatches(transition, tracks, lanes)
    ) {
        return null;
    }
    return {
        transition,
        matches: () => sourceStateMatches(transition),
        apply: () => {
            if (!sourceStateMatches(transition)) {
                return false;
            }
            applyTransition(transition);
            return true;
        },
    };
}
