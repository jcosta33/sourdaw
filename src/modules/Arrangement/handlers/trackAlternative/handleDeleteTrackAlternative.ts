import { createHandler } from '#/utils/createHandler';

import { type TrackAlternativeStateSnapshot } from '../../events/arrangementTrackAppActions';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isPromotableRuntimeClipCollection } from './isPromotableRuntimeClipCollection';
import {
    applyRetiredClipLanes,
    applyRetiredClipRows,
    captureRetiredClips,
    emptyRetiredClips,
    findRetiredClipIds,
} from './retiredAlternativeClips';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type TrackAlternative = Track['alternatives'][number];

type MutableTrackAlternativeStateSnapshot = {
    alternatives: TrackAlternativeStateSnapshot['alternatives'];
    activeAlternativeId: TrackAlternativeStateSnapshot['activeAlternativeId'];
    clips: TrackAlternativeStateSnapshot['clips'];
    retiredClips?: TrackAlternativeStateSnapshot['retiredClips'];
};

type PendingDeletion = {
    previous: MutableTrackAlternativeStateSnapshot;
    settled: MutableTrackAlternativeStateSnapshot;
};

// `describe()` runs before `execute()` and cannot know which alternative execute will
// promote, so it only seeds the shape the inverse guard needs. `execute()` fills the
// real post-delete state in after it writes — the same describe-then-finalize pattern
// `handleFreezeTrack` uses, so `executeAppAction`'s undo entry (built from the object
// `describe` returned, read again after `execute` runs) picks up the settled values.
const pendingDeletionSnapshots = new WeakMap<object, PendingDeletion>();

function isValidAlternativeCollection(value: unknown): value is TrackAlternative[] {
    if (!Array.isArray(value)) {
        return false;
    }

    try {
        const alternativeIds = new Set<string>();
        for (const candidate of value) {
            if (candidate === null || typeof candidate !== 'object') {
                return false;
            }

            const id: unknown = Reflect.get(candidate, 'id');
            const clips: unknown = Reflect.get(candidate, 'clips');
            if (typeof id !== 'string' || id.length === 0 || !Array.isArray(clips) || alternativeIds.has(id)) {
                return false;
            }
            alternativeIds.add(id);
        }
    } catch {
        return false;
    }

    return true;
}

type EligibleDeletionTarget = {
    state: TrackState;
    targetTrack: Track;
    filteredAlternatives: TrackAlternative[];
};

// Shared by `describe()` and `execute()`: the checks that decide whether a delete is
// even possible, before either one decides what (if anything) gets promoted. Keeping
// this in one place is what lets `describe()` safely pre-check eligibility without
// re-deriving the promotion decision, which stays exclusively in `execute()`.
function resolveEligibleDeletionTarget(trackId: string, alternativeId: unknown): EligibleDeletionTarget | null {
    const resolution = resolveEligibleClipWriteTarget({ trackId });
    if (resolution.status !== 'eligible') {
        return null;
    }

    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    const targetTrack = state.tracks.find((track) => track.id === resolution.trackId);
    if (
        !targetTrack ||
        typeof alternativeId !== 'string' ||
        alternativeId.length === 0 ||
        !isValidAlternativeCollection(targetTrack.alternatives) ||
        targetTrack.alternatives.length <= 1 ||
        typeof targetTrack.activeAlternativeId !== 'string' ||
        targetTrack.activeAlternativeId.length === 0
    ) {
        return null;
    }

    const activeAlternatives = targetTrack.alternatives.filter(
        (alternative) => alternative.id === targetTrack.activeAlternativeId
    );
    const alternativesToDelete = targetTrack.alternatives.filter((alternative) => alternative.id === alternativeId);
    if (activeAlternatives.length !== 1 || alternativesToDelete.length !== 1) {
        return null;
    }

    const filteredAlternatives = targetTrack.alternatives.filter((alternative) => alternative.id !== alternativeId);
    return { state, targetTrack, filteredAlternatives };
}

export const handleDeleteTrackAlternative = createHandler<'deleteTrackAlternative'>({
    execute: (action) => {
        const { trackId, alternativeId } = action.payload;
        const target = resolveEligibleDeletionTarget(trackId, alternativeId);
        if (!target) {
            return toHandlerExecutionResult(false);
        }
        const { state, targetTrack, filteredAlternatives } = target;

        let updatedTrack: Track = {
            ...targetTrack,
            alternatives: filteredAlternatives,
        };

        if (targetTrack.activeAlternativeId === alternativeId) {
            // Undo of createTrackAlternative passes fallbackAlternativeId so the
            // pre-create active alternative is restored, not the first in list.
            const requestedFallback = action.payload.fallbackAlternativeId
                ? filteredAlternatives.find((alternative) => alternative.id === action.payload.fallbackAlternativeId)
                : undefined;
            const fallbackAlternative = requestedFallback ?? filteredAlternatives[0];
            if (
                !fallbackAlternative ||
                !isPromotableRuntimeClipCollection({
                    value: fallbackAlternative.clips,
                    targetTrackId: targetTrack.id,
                    tracks: state.tracks,
                    source: { kind: 'alternative', trackId: targetTrack.id, alternativeId: fallbackAlternative.id },
                })
            ) {
                return toHandlerExecutionResult(false);
            }
            updatedTrack = {
                ...updatedTrack,
                activeAlternativeId: fallbackAlternative.id,
                clips: [...fallbackAlternative.clips],
            };
        }

        const tracksAfter = state.tracks.map((track) => (track.id === targetTrack.id ? updatedTrack : track));
        // The clips this alternative held leave the arrangement, so their rows in
        // the MIDI, automation and satellite stores leave with them, as a clip
        // removal retires them. Captured before the write so undo can put them back.
        const retiredClipIds = findRetiredClipIds(targetTrack, tracksAfter);
        const retiredClips = captureRetiredClips(retiredClipIds);
        const settledClips = emptyRetiredClips(retiredClipIds);
        if (!applyRetiredClipLanes(retiredClips, settledClips)) {
            return toHandlerExecutionResult(false);
        }
        setTrackStoreState({ ...state, tracks: tracksAfter });
        applyRetiredClipRows(retiredClips, settledClips);

        const pending = pendingDeletionSnapshots.get(action);
        if (pending) {
            pending.previous.retiredClips = retiredClips;
            pending.settled.alternatives = structuredClone(updatedTrack.alternatives);
            pending.settled.activeAlternativeId = updatedTrack.activeAlternativeId;
            pending.settled.clips = structuredClone(updatedTrack.clips);
            pending.settled.retiredClips = settledClips;
        }

        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const { trackId, alternativeId } = action.payload;
        const target = resolveEligibleDeletionTarget(trackId, alternativeId);
        if (!target) {
            return { label: 'Delete Alternative', inverseAction: null };
        }

        const previous: MutableTrackAlternativeStateSnapshot = structuredClone({
            alternatives: target.targetTrack.alternatives,
            activeAlternativeId: target.targetTrack.activeAlternativeId,
            clips: target.targetTrack.clips,
        });
        // Seeded empty; `execute()` overwrites these once it knows which alternative
        // (if any) actually got promoted and which clips actually got installed, and
        // adds to both sides the rows of the clips the delete retired.
        const settled: MutableTrackAlternativeStateSnapshot = {
            alternatives: [],
            activeAlternativeId: null,
            clips: [],
        };
        pendingDeletionSnapshots.set(action, { previous, settled });

        return {
            label: 'Delete Alternative',
            inverseAction: {
                type: 'restoreTrackAlternativeState',
                payload: { trackId, expected: settled, replacement: previous },
            },
            // Redo re-applies the exact promotion this run made rather than re-running
            // the delete: replaying `deleteTrackAlternative` after an intervening edit
            // could promote a different alternative than the one the user actually undid.
            redoAction: {
                type: 'restoreTrackAlternativeState',
                payload: { trackId, expected: previous, replacement: settled },
            },
        };
    },
    undoable: true,
});
