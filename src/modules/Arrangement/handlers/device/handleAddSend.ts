import { type LevelResolution, resolveSendLevelFields, SEND_LEVEL_LAW } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

type AddSendAction = Extract<AppAction, { type: 'addSend' }>;

/**
 * The linear amplitude this action asks for, whichever way it asked.
 *
 * The send does not exist yet, so a relative request has nothing on the track to
 * measure from and is measured from unity instead — "6 dB down" on a send being
 * created means 6 dB below the full copy of the signal it taps.
 */
function requestedLevel(action: AddSendAction): LevelResolution {
    return resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
}

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
        if (track.sends.some((send) => send.busId === action.payload.busId)) {
            return false;
        }
        return requestedLevel(action).ok;
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
        const requested = requestedLevel(alpha);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        const runtimeEffect = setSend(
            alpha.payload.trackId,
            alpha.payload.busId,
            requested.linear,
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
        // The inverse expects the level this action is about to write, stated
        // linearly whatever form the forward action used.
        const requested = requestedLevel(alpha);
        return {
            label,
            inverseAction:
                existing || !requested.ok
                    ? null
                    : {
                          type: 'removeSend',
                          payload: {
                              trackId: alpha.payload.trackId,
                              busId: alpha.payload.busId,
                              expectedLevel: requested.linear,
                              expectedPreFader: alpha.payload.preFader ?? false,
                          },
                      },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
