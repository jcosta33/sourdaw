import { createHandler } from '#/utils/createHandler';

import { removeSend } from '../../useCases/device/sendManagement/removeSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleRemoveSend = createHandler<'removeSend'>({
    execute: (alpha) => {
        removeSend(alpha.payload.trackId, alpha.payload.busId);
    },
    describe: (alpha) => {
        // Undo re-creates the send at its captured level through setSend, which
        // also re-wires the engine route. Known limitation: the action payload
        // carries no preFader flag, so an undone pre-fader send returns as
        // post-fader (setSend's default for new sends).
        const existing = getTrackStoreState()
            ?.tracks.find((time) => time.id === alpha.payload.trackId)
            ?.sends.find((state) => state.busId === alpha.payload.busId);
        return {
            label: 'Remove send',
            inverseAction: existing
                ? {
                      type: 'setSend',
                      payload: { trackId: alpha.payload.trackId, busId: alpha.payload.busId, level: existing.level },
                  }
                : null,
        };
    },
    undoable: true,
});
