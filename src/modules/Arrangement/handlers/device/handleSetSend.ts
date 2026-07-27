import { createHandler } from '#/utils/createHandler';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetSend = createHandler<'setSend'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setSend(alpha.payload.trackId, alpha.payload.busId, alpha.payload.level));
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.find((track) => track.id === action.payload.trackId)
            ?.sends.find((send) => send.busId === action.payload.busId)?.level === action.payload.level,
    describe: (alpha) => {
        const label = 'Set send level';
        // setSend updates in place when the send exists — restore the previous
        // level then; if this call creates the send, undo removes it.
        const state = getTrackStoreState();
        const track = state?.tracks.find((time) => time.id === alpha.payload.trackId);
        const target = state?.tracks.find((time) => time.id === alpha.payload.busId);
        if (
            !track ||
            !target ||
            !getTrackEligibility(track.kind).acceptsSend ||
            !getTrackEligibility(target.kind).acceptsRoutingEndpoint
        ) {
            return { label, inverseAction: null };
        }
        const existing = track.sends.find((state) => state.busId === alpha.payload.busId);
        return {
            label,
            inverseAction: existing
                ? {
                      type: 'setSend',
                      payload: { trackId: alpha.payload.trackId, busId: alpha.payload.busId, level: existing.level },
                  }
                : { type: 'removeSend', payload: { trackId: alpha.payload.trackId, busId: alpha.payload.busId } },
        };
    },
    undoable: true,
});
