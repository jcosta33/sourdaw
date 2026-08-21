import { createHandler } from '#/utils/createHandler';
import { type TrackAlternativeStateSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

import { isPromotableRuntimeClipCollection } from './isPromotableRuntimeClipCollection';

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

/**
 * Inverse and redo of `deleteTrackAlternative`. Deletion drops the alternative, may
 * promote a different one, and rewrites the track's live clips — all three come back
 * (or go forward again, for redo) together in one guarded write.
 */
export const handleRestoreTrackAlternativeState = createHandler<'restoreTrackAlternativeState'>({
    execute: (action) => {
        const { trackId, expected, replacement } = action.payload;
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) => candidate.id === trackId);
        if (!state || !track || !alternativeStateMatches(track, expected)) {
            return { status: 'conflict' };
        }

        const replacementActiveAlternativeId = replacement.activeAlternativeId;
        if (typeof replacementActiveAlternativeId !== 'string' || replacementActiveAlternativeId.length === 0) {
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
                    value: replacement.clips,
                    targetTrackId: trackId,
                    tracks: state.tracks,
                    source: { kind: 'alternative', trackId, alternativeId: replacementActiveAlternativeId },
                })
            ) {
                return { status: 'conflict' };
            }
        }

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((candidate) =>
                candidate.id === trackId
                    ? {
                          ...candidate,
                          // The contract types pin only the identity fields the guard
                          // compares; the payload actually carries whole alternative and
                          // clip objects via `structuredClone`, the same convention
                          // `TrackSnapshot` / `handleRestoreTrack` already use.
                          alternatives: replacement.alternatives as never,
                          activeAlternativeId: replacementActiveAlternativeId,
                          clips: replacement.clips as never,
                      }
                    : candidate
            ),
        });

        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore track alternative state', inverseAction: null }),
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return track !== undefined && alternativeStateMatches(track, action.payload.replacement);
    },
    undoable: false,
});
