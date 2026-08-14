import { createHandler } from '#/utils/createHandler';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleAddSend = createHandler<'addSend'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedAbsent === true,
    validate: (action, context) => {
        const track = getPlannedTrackState(context, action.payload.trackId);
        const target = getPlannedTrackState(context, action.payload.busId);
        if (!track || !target) {
            return false;
        }
        if (!getTrackEligibility(track.kind).acceptsSend || !getTrackEligibility(target.kind).acceptsRoutingEndpoint) {
            return false;
        }
        return !track.sends.some((send) => send.busId === action.payload.busId);
    },
    execute: (alpha) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) => candidate.id === alpha.payload.trackId);
        const target = state?.tracks.find((candidate) => candidate.id === alpha.payload.busId);
        if (
            (track && !getTrackEligibility(track.kind).acceptsSend) ||
            (target && !getTrackEligibility(target.kind).acceptsRoutingEndpoint)
        ) {
            if (alpha.payload.expectedAbsent) {
                return { status: 'conflict' };
            }
            return { status: 'no-write' };
        }
        const existing = track?.sends.some((send) => send.busId === alpha.payload.busId);
        if (existing) {
            return { status: 'conflict' };
        }
        const runtimeEffect = setSend(
            alpha.payload.trackId,
            alpha.payload.busId,
            alpha.payload.level,
            alpha.payload.preFader ?? false,
            { deferRuntimeEffect: true }
        );
        if (!runtimeEffect) {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            afterCommit: runtimeEffect.afterCommit,
            afterAmbiguousCommit: runtimeEffect.afterAmbiguousCommit,
        };
    },
    describe: (alpha) => {
        const label = 'Add send';
        const track = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        if (!track && alpha.payload.expectedAbsent !== true) {
            return { label, inverseAction: null };
        }
        const existing = track?.sends.find((state) => state.busId === alpha.payload.busId);
        return {
            label,
            inverseAction: existing
                ? null
                : {
                      type: 'removeSend',
                      payload: {
                          trackId: alpha.payload.trackId,
                          busId: alpha.payload.busId,
                          expectedLevel: alpha.payload.level,
                          expectedPreFader: alpha.payload.preFader ?? false,
                      },
                  },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
