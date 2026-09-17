import {
    DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT,
    type TransformItemBinding,
    type TransformSelector,
    type TransformSelectorFilter,
    type TransformSnapshot,
    type TransformSnapshotTrack,
} from '../../models/DeclarativeTransform';

export type TransformSelectionResult =
    { status: 'selected'; items: readonly TransformItemBinding[] } | { status: 'rejected'; reason: string };

/** Filters that read a clip's placement and therefore say nothing about a track. */
const CLIP_ONLY_FILTERS = ['startsAtOrAfterBeat', 'endsAtOrBeforeBeat'] as const;

function matchesFilter(
    filter: TransformSelectorFilter,
    input: { contentType: 'audio' | 'midi' | null; name: string; trackId: string }
): boolean {
    if ('contentType' in filter && filter.contentType !== input.contentType) {
        return false;
    }
    if (filter.nameIncludes !== undefined && !input.name.includes(filter.nameIncludes)) {
        return false;
    }
    return filter.trackId === undefined || filter.trackId === input.trackId;
}

function selectTracks(
    filter: TransformSelectorFilter,
    tracks: readonly TransformSnapshotTrack[]
): TransformItemBinding[] {
    return tracks
        .filter((track) =>
            matchesFilter(filter, { contentType: track.contentType, name: track.name, trackId: track.id })
        )
        .map((track, index) => ({ index, id: track.id, name: track.name, target: 'track' as const, span: null }));
}

function selectClips(
    filter: TransformSelectorFilter,
    tracks: readonly TransformSnapshotTrack[]
): TransformItemBinding[] {
    const matched = tracks.flatMap((track) =>
        track.clips
            .filter(
                (clip) =>
                    matchesFilter(filter, { contentType: track.contentType, name: clip.name, trackId: track.id }) &&
                    (filter.startsAtOrAfterBeat === undefined || clip.startBeat >= filter.startsAtOrAfterBeat) &&
                    (filter.endsAtOrBeforeBeat === undefined || clip.endBeat <= filter.endsAtOrBeforeBeat)
            )
            .map((clip) => ({
                id: clip.id,
                name: clip.name,
                target: 'clip' as const,
                span: { startBeat: clip.startBeat, endBeat: clip.endBeat },
            }))
    );
    return matched.map((item, index) => ({ ...item, index }));
}

/**
 * Resolves one selector against the snapshot in snapshot order, keeping at most `limit` items. The
 * limit is the whole of the iteration bound: a document declares no other way to repeat a step.
 */
export function selectTransformItems(
    selector: TransformSelector,
    snapshot: TransformSnapshot,
    label: string
): TransformSelectionResult {
    if (!Number.isInteger(selector.limit) || selector.limit < 1) {
        return { status: 'rejected', reason: `iteration bound: ${label} declares a limit that is not a whole count` };
    }
    if (selector.limit > DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT) {
        return {
            status: 'rejected',
            reason: `iteration bound: ${label} declares limit ${String(selector.limit)}, above the maximum ${String(DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT)}`,
        };
    }
    const filter = selector.where ?? {};
    const inapplicable = selector.target === 'track' ? CLIP_ONLY_FILTERS.filter((name) => name in filter) : [];
    if (inapplicable.length > 0) {
        return { status: 'rejected', reason: `${label} filters a track selector by ${inapplicable.join(' and ')}` };
    }
    const items =
        selector.target === 'track' ? selectTracks(filter, snapshot.tracks) : selectClips(filter, snapshot.tracks);
    return { status: 'selected', items: items.slice(0, selector.limit) };
}
