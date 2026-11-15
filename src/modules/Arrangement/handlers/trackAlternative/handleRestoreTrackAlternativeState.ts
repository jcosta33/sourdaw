import { createHandler } from '#/utils/createHandler';

import { type TrackAlternativeStateSnapshot } from '../../events/arrangementTrackAppActions';
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
        if (retiredClips.kind === 'move' && !applyRetiredClipLanes(retiredClips.expected, retiredClips.replacement)) {
            return { status: 'conflict' };
        }

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((candidate) =>
                candidate.id === trackId
                    ? {
                          ...candidate,
                          alternatives,
                          activeAlternativeId: replacementActiveAlternativeId,
                          clips,
                      }
                    : candidate
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
