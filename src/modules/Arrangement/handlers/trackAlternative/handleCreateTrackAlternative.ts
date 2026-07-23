import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type Clip = Track['clips'][number];
type TrackAlternative = Track['alternatives'][number];

type CreateTrackAlternativeAction = {
    payload: { trackId: string; name: string; duplicateActive: boolean; alternativeId?: string };
};

// Mirror of handleDuplicateClip's ensureTargetClipId: the inverse needs the new
// alternative's id before execute runs, so describe mints it onto the payload
// and execute reuses it (describe always runs before execute).
function ensureAlternativeId(action: CreateTrackAlternativeAction): string {
    if (action.payload.alternativeId) {
        return action.payload.alternativeId;
    }
    const alternativeId = `alt-${crypto.randomUUID()}`;
    action.payload.alternativeId = alternativeId;
    return alternativeId;
}

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
        if (typeof name !== 'string' || typeof duplicateActive !== 'boolean') {
            return toHandlerExecutionResult(false);
        }

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

        const newAltId = ensureAlternativeId(action);
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
    describe: (action) => {
        // Undo deletes the newly created alternative and falls back to the
        // pre-create active alternative (NOT deleteTrackAlternative's default
        // first-in-list fallback — that could restore the wrong active index).
        const prevActiveId = getTrackStoreState()?.tracks.find(
            (track) => track.id === action.payload.trackId
        )?.activeAlternativeId;
        if (typeof prevActiveId !== 'string' || prevActiveId.length === 0) {
            return { label: 'Create Alternative', inverseAction: null };
        }
        return {
            label: 'Create Alternative',
            inverseAction: {
                type: 'deleteTrackAlternative',
                payload: {
                    trackId: action.payload.trackId,
                    alternativeId: ensureAlternativeId(action),
                    fallbackAlternativeId: prevActiveId,
                },
            },
        };
    },
    undoable: true,
});
