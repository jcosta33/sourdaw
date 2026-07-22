import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type Clip = Track['clips'][number];
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

export const handleCreateTrackAlternative = createHandler<'createTrackAlternative'>({
    execute: (action) => {
        const { trackId, name, duplicateActive } = action.payload;
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
            !Array.isArray(targetTrack.clips) ||
            !isValidAlternativeCollection(targetTrack.alternatives) ||
            typeof targetTrack.activeAlternativeId !== 'string' ||
            targetTrack.activeAlternativeId.length === 0
        ) {
            return toHandlerExecutionResult(false);
        }

        const activeAlternatives = targetTrack.alternatives.filter(
            (alternative) => alternative.id === targetTrack.activeAlternativeId
        );
        if (activeAlternatives.length !== 1) {
            return toHandlerExecutionResult(false);
        }

        const newAltId = `alt-${crypto.randomUUID()}`;
        if (targetTrack.alternatives.some((alternative) => alternative.id === newAltId)) {
            return toHandlerExecutionResult(false);
        }

        let newClips: Clip[] = [];
        if (duplicateActive) {
            newClips = targetTrack.clips.map((context) => ({ ...context, id: `clip-${crypto.randomUUID()}` }));
        }

        const newAlternative: TrackAlternative = {
            id: newAltId,
            name,
            clips: newClips,
        };

        const updatedAlternatives = targetTrack.alternatives.map((alternative) => {
            if (alternative.id === targetTrack.activeAlternativeId) {
                return { ...alternative, clips: [...targetTrack.clips] };
            }
            return alternative;
        });
        updatedAlternatives.push(newAlternative);

        const updatedTrack: Track = {
            ...targetTrack,
            alternatives: updatedAlternatives,
            activeAlternativeId: newAltId,
            clips: newClips,
        };

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => (track.id === targetTrack.id ? updatedTrack : track)),
        });

        return toHandlerExecutionResult(true);
    },
    describe: () => ({ label: 'Create Alternative' }),
    undoable: true,
});
