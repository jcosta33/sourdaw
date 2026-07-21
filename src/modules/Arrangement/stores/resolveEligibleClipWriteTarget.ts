import { getTrackEligibility } from './trackEligibility';
import { trackStore } from './trackStore';

type EligibleClipAddTarget = Readonly<{
    status: 'eligible';
    trackId: string;
}>;

type EligibleClipUpdateTarget = Readonly<{
    status: 'eligible';
    trackId: string;
    clipId: string;
}>;

type UnresolvedClipWriteTarget = Readonly<{
    status: 'missing' | 'ineligible';
}>;

export type ClipWriteTargetResolution = EligibleClipAddTarget | EligibleClipUpdateTarget | UnresolvedClipWriteTarget;

type ClipWriteTargetInput =
    Readonly<{ trackId: string; clipId?: never }> | Readonly<{ clipId: string; trackId?: never }>;

type TrackEligibilityKind = Parameters<typeof getTrackEligibility>[0];

type NormalizedClipOwner = Readonly<{
    id: string;
}>;

type NormalizedTrackOwner = Readonly<{
    id: string;
    kind: TrackEligibilityKind;
    clips: ReadonlyArray<NormalizedClipOwner>;
}>;

type NormalizedStore = Readonly<{
    status: 'valid';
    tracks: ReadonlyArray<NormalizedTrackOwner>;
}>;

type UnresolvedStore = Readonly<{
    status: 'missing' | 'ineligible';
}>;

type StoreNormalization = NormalizedStore | UnresolvedStore;

const INELIGIBLE: ClipWriteTargetResolution = Object.freeze({ status: 'ineligible' });
const MISSING: ClipWriteTargetResolution = Object.freeze({ status: 'missing' });

function isObject(value: unknown): value is object {
    return value !== null && typeof value === 'object';
}

function isTrackEligibilityKind(value: unknown): value is TrackEligibilityKind {
    return (
        value === 'audio' ||
        value === 'midi' ||
        value === 'bus' ||
        value === 'master' ||
        value === 'folder' ||
        value === 'vca'
    );
}

function normalizeStore(): StoreNormalization {
    const state: unknown = trackStore.value;
    if (!isObject(state)) {
        return { status: 'missing' };
    }

    const candidates: unknown = Reflect.get(state, 'tracks');
    if (!Array.isArray(candidates)) {
        return { status: 'ineligible' };
    }

    const trackIds = new Set<string>();
    const clipIds = new Set<string>();
    const tracks: NormalizedTrackOwner[] = [];

    for (const candidate of candidates) {
        if (!isObject(candidate)) {
            return { status: 'ineligible' };
        }

        const trackId: unknown = Reflect.get(candidate, 'id');
        const kind: unknown = Reflect.get(candidate, 'kind');
        const clipCandidates: unknown = Reflect.get(candidate, 'clips');
        if (
            typeof trackId !== 'string' ||
            trackId.length === 0 ||
            !isTrackEligibilityKind(kind) ||
            !Array.isArray(clipCandidates)
        ) {
            return { status: 'ineligible' };
        }

        if (trackIds.has(trackId)) {
            return { status: 'ineligible' };
        }
        trackIds.add(trackId);

        const clips: NormalizedClipOwner[] = [];
        for (const clipCandidate of clipCandidates) {
            if (!isObject(clipCandidate)) {
                return { status: 'ineligible' };
            }

            const clipId: unknown = Reflect.get(clipCandidate, 'id');
            const clipTrackId: unknown = Reflect.get(clipCandidate, 'trackId');
            if (typeof clipId !== 'string' || clipId.length === 0 || clipTrackId !== trackId || clipIds.has(clipId)) {
                return { status: 'ineligible' };
            }

            clipIds.add(clipId);
            clips.push({ id: clipId });
        }

        tracks.push({ id: trackId, kind, clips });
    }

    return { status: 'valid', tracks };
}

function resolveTrackTarget(tracks: ReadonlyArray<NormalizedTrackOwner>, trackId: string): ClipWriteTargetResolution {
    const owner = tracks.find((track) => track.id === trackId);
    if (!owner) {
        return MISSING;
    }

    if (!getTrackEligibility(owner.kind).acceptsClipAdd) {
        return INELIGIBLE;
    }

    return Object.freeze({ status: 'eligible', trackId });
}

function resolveClipTarget(tracks: ReadonlyArray<NormalizedTrackOwner>, clipId: string): ClipWriteTargetResolution {
    for (const track of tracks) {
        if (!track.clips.some((clip) => clip.id === clipId)) {
            continue;
        }

        if (!getTrackEligibility(track.kind).acceptsClipUpdate) {
            return INELIGIBLE;
        }

        return Object.freeze({ status: 'eligible', trackId: track.id, clipId });
    }

    return MISSING;
}

function resolveClipWriteTarget(input: unknown): ClipWriteTargetResolution {
    if (!isObject(input)) {
        return INELIGIBLE;
    }

    const hasTrackId = Object.hasOwn(input, 'trackId');
    const hasClipId = Object.hasOwn(input, 'clipId');
    if (hasTrackId === hasClipId) {
        return INELIGIBLE;
    }

    let requestedId: unknown;
    if (hasTrackId) {
        requestedId = Reflect.get(input, 'trackId');
    } else {
        requestedId = Reflect.get(input, 'clipId');
    }
    if (typeof requestedId !== 'string' || requestedId.length === 0) {
        return INELIGIBLE;
    }

    const store = normalizeStore();
    if (store.status !== 'valid') {
        if (store.status === 'missing') {
            return MISSING;
        }
        return INELIGIBLE;
    }

    if (hasTrackId) {
        return resolveTrackTarget(store.tracks, requestedId);
    }
    return resolveClipTarget(store.tracks, requestedId);
}

export function resolveEligibleClipWriteTarget(input: ClipWriteTargetInput): ClipWriteTargetResolution {
    try {
        return resolveClipWriteTarget(input);
    } catch {
        return INELIGIBLE;
    }
}
