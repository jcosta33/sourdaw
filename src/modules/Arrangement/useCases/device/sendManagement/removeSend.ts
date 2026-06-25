import { removeSend as engineRemoveSend } from '#/modules/Routing/useCases';

import { updateTrack } from '../../../repositories/track/updateTrack';

export function removeSend(trackId: string, busId: string): void {
    updateTrack(trackId, (time) => ({
        ...time,
        sends: time.sends.filter((state) => state.busId !== busId),
    }));

    // The store update only removes the send from project truth — the live send
    // GainNode stays wired into the bus, so audio keeps summing to it after the
    // UI shows the send gone (and the stale path replicates to peers). Disconnect
    // it through the engine, mirroring setSend / toggleSendPreFader which also
    // pair the store write with the engine pass-through.
    engineRemoveSend(trackId, busId);
}
