import { getTrackEligibility } from './trackEligibility';
import { type Clip, type Track, type TrackStoreState, trackStore } from './trackStore';

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
    source: Clip;
}>;

type NormalizedTrackOwner = Readonly<{
    id: string;
    kind: TrackEligibilityKind;
    source: Track;
    snapshot: Track;
    clips: ReadonlyArray<NormalizedClipOwner>;
    acceptsClipAdd: boolean;
    acceptsClipUpdate: boolean;
}>;

type NormalizedStore = Readonly<{
    status: 'valid';
    snapshot: TrackStoreState;
    tracks: ReadonlyArray<NormalizedTrackOwner>;
    tracksById: ReadonlyMap<string, NormalizedTrackOwner>;
    clipsById: ReadonlyMap<string, NormalizedTrackOwner>;
}>;

type UnresolvedStore = Readonly<{
    status: 'missing' | 'ineligible';
}>;

type StoreNormalization = NormalizedStore | UnresolvedStore;

const INELIGIBLE: ClipWriteTargetResolution = Object.freeze({ status: 'ineligible' });
const MISSING: ClipWriteTargetResolution = Object.freeze({ status: 'missing' });
const INELIGIBLE_STORE: StoreNormalization = Object.freeze({ status: 'ineligible' });
const MISSING_STORE: StoreNormalization = Object.freeze({ status: 'missing' });

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

function normalizeStore(state: TrackStoreState | null | undefined): StoreNormalization {
    if (state === null || state === undefined) {
        return MISSING_STORE;
    }

    const runtimeState: unknown = state;
    if (!isObject(runtimeState)) {
        return INELIGIBLE_STORE;
    }

    const snapshot = { ...state };
    const runtimeCandidates: unknown = snapshot.tracks;
    if (!Array.isArray(runtimeCandidates)) {
        return INELIGIBLE_STORE;
    }
    const candidates = snapshot.tracks;

    const tracksById = new Map<string, NormalizedTrackOwner>();
    const clipsById = new Map<string, NormalizedTrackOwner>();
    const clipIds = new Set<string>();
    const tracks: NormalizedTrackOwner[] = [];

    for (const candidate of candidates) {
        const runtimeCandidate: unknown = candidate;
        if (!isObject(runtimeCandidate)) {
            return INELIGIBLE_STORE;
        }

        const trackSnapshot = { ...candidate };
        const trackId: unknown = trackSnapshot.id;
        const kind: unknown = trackSnapshot.kind;
        const runtimeClipCandidates: unknown = trackSnapshot.clips;
        if (
            typeof trackId !== 'string' ||
            trackId.length === 0 ||
            !isTrackEligibilityKind(kind) ||
            !Array.isArray(runtimeClipCandidates)
        ) {
            return INELIGIBLE_STORE;
        }
        const clipCandidates = trackSnapshot.clips;

        if (tracksById.has(trackId)) {
            return INELIGIBLE_STORE;
        }

        const clips: NormalizedClipOwner[] = [];
        for (const clipCandidate of clipCandidates) {
            const runtimeClipCandidate: unknown = clipCandidate;
            if (!isObject(runtimeClipCandidate)) {
                return INELIGIBLE_STORE;
            }

            const clipSnapshot = { ...clipCandidate };
            const clipId: unknown = clipSnapshot.id;
            const clipTrackId: unknown = clipSnapshot.trackId;
            if (typeof clipId !== 'string' || clipId.length === 0 || clipTrackId !== trackId || clipIds.has(clipId)) {
                return INELIGIBLE_STORE;
            }

            clipIds.add(clipId);
            clips.push(Object.freeze({ id: clipId, source: clipCandidate }));
        }

        const eligibility = getTrackEligibility(kind);
        const owner = Object.freeze({
            id: trackId,
            kind,
            source: candidate,
            snapshot: trackSnapshot,
            clips: Object.freeze(clips),
            acceptsClipAdd: eligibility.acceptsClipAdd,
            acceptsClipUpdate: eligibility.acceptsClipUpdate,
        });
        tracksById.set(trackId, owner);
        for (const clip of clips) {
            clipsById.set(clip.id, owner);
        }
        tracks.push(owner);
    }

    return Object.freeze({
        status: 'valid',
        snapshot: Object.freeze(snapshot),
        tracks: Object.freeze(tracks),
        tracksById,
        clipsById,
    });
}

export function createClipWriteTargetIndex(state: TrackStoreState | null | undefined): StoreNormalization {
    try {
        return normalizeStore(state);
    } catch {
        return INELIGIBLE_STORE;
    }
}

function resolveTrackTarget(store: NormalizedStore, trackId: string): ClipWriteTargetResolution {
    const owner = store.tracksById.get(trackId);
    if (!owner) {
        return MISSING;
    }

    if (!owner.acceptsClipAdd) {
        return INELIGIBLE;
    }

    return Object.freeze({ status: 'eligible', trackId });
}

function resolveClipTarget(store: NormalizedStore, clipId: string): ClipWriteTargetResolution {
    const owner = store.clipsById.get(clipId);
    if (!owner) {
        return MISSING;
    }

    if (!owner.acceptsClipUpdate) {
        return INELIGIBLE;
    }

    return Object.freeze({ status: 'eligible', trackId: owner.id, clipId });
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

    const store = createClipWriteTargetIndex(trackStore.value);
    if (store.status !== 'valid') {
        if (store.status === 'missing') {
            return MISSING;
        }
        return INELIGIBLE;
    }

    if (hasTrackId) {
        return resolveTrackTarget(store, requestedId);
    }
    return resolveClipTarget(store, requestedId);
}

export function resolveEligibleClipWriteTarget(input: ClipWriteTargetInput): ClipWriteTargetResolution {
    try {
        return resolveClipWriteTarget(input);
    } catch {
        return INELIGIBLE;
    }
}
