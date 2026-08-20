import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isPromotableRuntimeClipCollection } from './isPromotableRuntimeClipCollection';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type TrackAlternative = Track['alternatives'][number];

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

export const handleDeleteTrackAlternative = createHandler<'deleteTrackAlternative'>({
    execute: (action) => {
        const { trackId, alternativeId } = action.payload;
        const resolution = resolveEligibleClipWriteTarget({ trackId });
        if (resolution.status !== 'eligible') {
            return toHandlerExecutionResult(false);
        }

        const state = getTrackStoreState();
        if (!state) {
            return toHandlerExecutionResult(false);
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
            return toHandlerExecutionResult(false);
        }

        const activeAlternatives = targetTrack.alternatives.filter(
            (alternative) => alternative.id === targetTrack.activeAlternativeId
        );
        const alternativesToDelete = targetTrack.alternatives.filter((alternative) => alternative.id === alternativeId);
        if (activeAlternatives.length !== 1 || alternativesToDelete.length !== 1) {
            return toHandlerExecutionResult(false);
        }

        const filteredAlternatives = targetTrack.alternatives.filter((alternative) => alternative.id !== alternativeId);
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

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => (track.id === targetTrack.id ? updatedTrack : track)),
        });

        return toHandlerExecutionResult(true);
    },
    describe: () => ({ label: 'Delete Alternative' }),
    undoable: false,
});
