import { createHandler } from '#/utils/createHandler';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackOutput } from '../../useCases/toggleTrackState/setTrackOutput';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleSetTrackOutput = createHandler<'setTrackOutput'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedOutputId !== undefined,
    validate: (action, context) => {
        const track = getPlannedTrackState(context, action.payload.trackId);
        const target = getPlannedTrackState(context, action.payload.outputId);
        if (!track || (!target && action.payload.outputId !== 'master' && action.payload.outputId !== 'hw_out')) {
            return false;
        }
        if (
            !getTrackEligibility(track.kind).acceptsOutput ||
            (target !== null && !getTrackEligibility(target.kind).acceptsRoutingEndpoint)
        ) {
            return false;
        }
        return action.payload.expectedOutputId === undefined || track.outputId === action.payload.expectedOutputId;
    },
    execute: (action) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const target = state?.tracks.find((candidate) => candidate.id === action.payload.outputId);
        if (
            (track && !getTrackEligibility(track.kind).acceptsOutput) ||
            (target && !getTrackEligibility(target.kind).acceptsRoutingEndpoint)
        ) {
            if (action.payload.expectedOutputId !== undefined) {
                return { status: 'conflict' };
            }
            return { status: 'no-write' };
        }
        if (action.payload.expectedOutputId !== undefined && track?.outputId !== action.payload.expectedOutputId) {
            return { status: 'conflict' };
        }
        const runtimeEffect = setTrackOutput(action.payload.trackId, action.payload.outputId, {
            deferRuntimeEffect: true,
        });
        if (!runtimeEffect) {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            afterCommit: runtimeEffect.afterCommit,
            afterAmbiguousCommit: runtimeEffect.afterAmbiguousCommit,
        };
    },
    isNoop: (action) => {
        const outputId = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.outputId;
        if (action.payload.expectedOutputId !== undefined && outputId !== action.payload.expectedOutputId) {
            return false;
        }
        return outputId === action.payload.outputId;
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track) {
            return { label: 'Set track output', inverseAction: null };
        }
        return {
            label: 'Set track output',
            inverseAction: {
                type: 'setTrackOutput',
                payload: {
                    trackId: action.payload.trackId,
                    outputId: track.outputId,
                    expectedOutputId: action.payload.outputId,
                },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
