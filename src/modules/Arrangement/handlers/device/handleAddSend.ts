import { createHandler } from '#/utils/createHandler';

import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleAddSend = createHandler<'addSend'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setSend(alpha.payload.trackId, alpha.payload.busId, alpha.payload.level));
    },
    describe: (alpha) => {
        const label = 'Add send';
        // setSend updates in place when the send already exists — undoing a
        // genuine add removes the send, but undoing an in-place update must
        // restore the previous level instead of removing the send.
        const track = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        if (!track) {
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
