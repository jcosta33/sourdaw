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

export const handleSwitchTrackAlternative = createHandler<'switchTrackAlternative'>({
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
        if (!targetTrack || targetTrack.activeAlternativeId === alternativeId) {
            return toHandlerExecutionResult(false);
        }
        if (
            typeof alternativeId !== 'string' ||
            alternativeId.length === 0 ||
            !Array.isArray(targetTrack.clips) ||
            !isValidAlternativeCollection(targetTrack.alternatives) ||
            typeof targetTrack.activeAlternativeId !== 'string' ||
            targetTrack.activeAlternativeId.length === 0
        ) {
            return toHandlerExecutionResult(false);
        }

        const targetAlternatives = targetTrack.alternatives.filter((alternative) => alternative.id === alternativeId);
        const activeAlternatives = targetTrack.alternatives.filter(
            (alternative) => alternative.id === targetTrack.activeAlternativeId
        );
        if (targetAlternatives.length !== 1 || activeAlternatives.length !== 1) {
            return toHandlerExecutionResult(false);
        }

        const targetAlternative = targetAlternatives[0];
        if (!targetAlternative) {
            return toHandlerExecutionResult(false);
        }
        if (
            !isPromotableRuntimeClipCollection({
                value: targetTrack.clips,
                targetTrackId: targetTrack.id,
                tracks: state.tracks,
                source: {
                    kind: 'active',
                    trackId: targetTrack.id,
                    activeAlternativeId: targetTrack.activeAlternativeId,
                },
            }) ||
            !isPromotableRuntimeClipCollection({
                value: targetAlternative.clips,
                targetTrackId: targetTrack.id,
                tracks: state.tracks,
                source: { kind: 'alternative', trackId: targetTrack.id, alternativeId: targetAlternative.id },
            })
        ) {
            return toHandlerExecutionResult(false);
        }

        const updatedAlternatives = targetTrack.alternatives.map((alternative) => {
            if (alternative.id === targetTrack.activeAlternativeId) {
                return { ...alternative, clips: [...targetTrack.clips] };
            }
            return alternative;
        });

        const updatedTrack: Track = {
            ...targetTrack,
            alternatives: updatedAlternatives,
            activeAlternativeId: alternativeId,
            clips: [...targetAlternative.clips],
        };

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => (track.id === targetTrack.id ? updatedTrack : track)),
        });

        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        // Switching is a symmetric swap: undo switches back to the captured
        // pre-switch active alternative. Switching to the already-active
        // alternative is a forward no-write, so no undo entry is recorded then.
        const prevActiveId = getTrackStoreState()?.tracks.find(
            (track) => track.id === action.payload.trackId
        )?.activeAlternativeId;
        return {
            label: 'Switch Alternative',
            inverseAction:
                typeof prevActiveId === 'string' && prevActiveId.length > 0
                    ? {
                          type: 'switchTrackAlternative',
                          payload: { trackId: action.payload.trackId, alternativeId: prevActiveId },
                      }
                    : null,
        };
    },
    undoable: true,
});
