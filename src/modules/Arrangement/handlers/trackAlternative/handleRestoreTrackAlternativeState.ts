import { createHandler } from '#/utils/createHandler';

import { type TrackAlternativeStateSnapshot } from '../../events/arrangementTrackAppActions';
import { getHeldClips } from '../../models/TrackAlternativeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

import { isPromotableRuntimeClipCollection } from './isPromotableRuntimeClipCollection';
import { isRestorableAlternatives, isRestorableClips } from './isRestorableAlternativeState';
import {
    applyRetiredClipLanes,
    applyRetiredClipRows,
    applyRetiredTakeLanes,
    retiredClipsTransitionIsAdmissible,
} from './retiredAlternativeClips';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type TrackClipCollections = Pick<Track, 'activeAlternativeId' | 'alternatives' | 'clips'>;

// Compares the alternative id sequence and active id rather than deep-equating the
// snapshot: a deep compare would spuriously conflict on recomputed fields, while an id
// sequence compare is exactly what detects an alternative added, removed, or reordered.
function alternativeStateMatches(track: Track, snapshot: TrackAlternativeStateSnapshot): boolean {
    if (track.activeAlternativeId !== snapshot.activeAlternativeId) {
        return false;
    }
    if (track.alternatives.length !== snapshot.alternatives.length) {
        return false;
    }
    return track.alternatives.every((alternative, index) => alternative.id === snapshot.alternatives[index]?.id);
}

function readRetiredClipOwners(track: TrackClipCollections, retiredIds: ReadonlySet<string>) {
    const tagOwners = (clips: Track['clips'], alternativeId: string) =>
        clips.filter((clip) => retiredIds.has(clip.id)).map((clip) => ({ clipId: clip.id, alternativeId }));
    const owners = getHeldClips({
        activeAlternativeId: track.activeAlternativeId,
        clips: tagOwners(track.clips, track.activeAlternativeId),
        alternatives: track.alternatives.map(({ id, clips }) => ({ id, clips: tagOwners(clips, id) })),
    });
    return Map.groupBy(owners, (owner) => owner.clipId);
}

function retiredClipOwnersMatch(
    tracks: TrackState['tracks'],
    track: Track,
    expected: TrackAlternativeStateSnapshot,
    replacement: TrackClipCollections,
    clipIds: readonly string[]
): boolean {
    if (clipIds.length === 0) {
        return true;
    }
    if (!isRestorableAlternatives(expected.alternatives, track.id) || !isRestorableClips(expected.clips, track.id)) {
        return false;
    }
    const retiredIds = new Set(clipIds);
    const hasOtherTrackOwner = tracks.some(
        (candidate) => candidate.id !== track.id && getHeldClips(candidate).some((clip) => retiredIds.has(clip.id))
    );
    if (hasOtherTrackOwner) {
        return false;
    }
    const liveOwners = readRetiredClipOwners(track, retiredIds);
    const expectedOwners = readRetiredClipOwners(
        { activeAlternativeId: track.activeAlternativeId, alternatives: expected.alternatives, clips: expected.clips },
        retiredIds
    );
    const replacementOwners = readRetiredClipOwners(replacement, retiredIds);
    return clipIds.every((clipId) => {
        const live = liveOwners.get(clipId) ?? [];
        const before = expectedOwners.get(clipId) ?? [];
        const after = replacementOwners.get(clipId) ?? [];
        // Undo adds one owner and redo removes it. An active alternative's stored copy is stale.
        return (
            before.length + after.length === 1 &&
            live.length === before.length &&
            live[0]?.alternativeId === before[0]?.alternativeId
        );
    });
}

type RetiredClipsTransition =
    | { readonly kind: 'none' }
    | {
          readonly kind: 'move';
          readonly expected: NonNullable<TrackAlternativeStateSnapshot['retiredClips']>;
          readonly replacement: NonNullable<TrackAlternativeStateSnapshot['retiredClips']>;
      }
    | { readonly kind: 'refused' };

// Entries recorded before deletes retired clip data carry neither side and move
// nothing; a payload carrying only one side is not one the delete produced.
function readRetiredClipsTransition(
    expected: TrackAlternativeStateSnapshot,
    replacement: TrackAlternativeStateSnapshot
): RetiredClipsTransition {
    if (expected.retiredClips === undefined && replacement.retiredClips === undefined) {
        return { kind: 'none' };
    }
    if (
        expected.retiredClips === undefined ||
        replacement.retiredClips === undefined ||
        !retiredClipsTransitionIsAdmissible(expected.retiredClips, replacement.retiredClips)
    ) {
        return { kind: 'refused' };
    }
    return { kind: 'move', expected: expected.retiredClips, replacement: replacement.retiredClips };
}

/**
 * Inverse and redo of `deleteTrackAlternative`. Deletion drops the alternative, may
 * promote a different one, rewrites the track's live clips, and retires the MIDI,
 * satellite, clip-lane and take rows of the clips the alternative held — all of it comes
 * back (or goes forward again, for redo) together in one guarded write.
 */
export const handleRestoreTrackAlternativeState = createHandler<'restoreTrackAlternativeState'>({
    execute: (action) => {
        const { trackId, expected, replacement } = action.payload;
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) => candidate.id === trackId);
        if (!state || !track || !alternativeStateMatches(track, expected)) {
            return { status: 'conflict' };
        }

        const { activeAlternativeId: replacementActiveAlternativeId, alternatives, clips } = replacement;
        if (
            typeof replacementActiveAlternativeId !== 'string' ||
            replacementActiveAlternativeId.length === 0 ||
            !isRestorableAlternatives(alternatives, trackId) ||
            !isRestorableClips(clips, trackId)
        ) {
            return { status: 'conflict' };
        }

        // Same validation the forward handler runs before promoting a fallback
        // alternative's clips to live `clips` — a restore must not install a clip
        // collection the forward path would itself have refused. Gated the same way
        // the forward handler gates it too: only when the active alternative is
        // actually changing. When it is not (deleting or restoring a non-active
        // alternative never touches live `clips`), `replacement.clips` already IS the
        // live `clips` — validating it against itself would read as a self-collision,
        // since `isPromotableRuntimeClipCollection` only ever skips an id match inside
        // the *alternatives* array, never against the track's own top-level `clips`.
        if (track.activeAlternativeId !== replacementActiveAlternativeId) {
            if (
                !isPromotableRuntimeClipCollection({
                    value: clips,
                    targetTrackId: trackId,
                    tracks: state.tracks,
                    source: { kind: 'alternative', trackId, alternativeId: replacementActiveAlternativeId },
                })
            ) {
                return { status: 'conflict' };
            }
        }

        const retiredClips = readRetiredClipsTransition(expected, replacement);
        if (retiredClips.kind === 'refused') {
            return { status: 'conflict' };
        }
        const replacementCollections = { alternatives, activeAlternativeId: replacementActiveAlternativeId, clips };
        if (
            retiredClips.kind === 'move' &&
            (!retiredClipOwnersMatch(
                state.tracks,
                track,
                expected,
                replacementCollections,
                retiredClips.expected.clipIds
            ) ||
                !applyRetiredClipLanes(retiredClips.expected, retiredClips.replacement))
        ) {
            return { status: 'conflict' };
        }

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((candidate) =>
                candidate.id === trackId ? { ...candidate, ...replacementCollections } : candidate
            ),
        });
        if (retiredClips.kind === 'move') {
            applyRetiredClipRows(retiredClips.expected, retiredClips.replacement);
            applyRetiredTakeLanes(retiredClips.expected, retiredClips.replacement);
        }

        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore track alternative state', inverseAction: null }),
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return track !== undefined && alternativeStateMatches(track, action.payload.replacement);
    },
    undoable: false,
});
