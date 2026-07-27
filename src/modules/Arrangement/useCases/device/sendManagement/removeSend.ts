import { removeSend as engineRemoveSend, setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';

type RemoveSendOptions = {
    deferRuntimeEffect?: boolean;
};

type DeferredRemoveSendRuntimeEffect = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function removeSend(trackId: string, busId: string): boolean;
export function removeSend(
    trackId: string,
    busId: string,
    options: { deferRuntimeEffect: true }
): DeferredRemoveSendRuntimeEffect | null;
export function removeSend(
    trackId: string,
    busId: string,
    options: RemoveSendOptions = {}
): boolean | DeferredRemoveSendRuntimeEffect | null {
    const track = getTrackById(trackId);
    if (!track?.sends.some((send) => send.busId === busId)) {
        return false;
    }
    updateTrack(trackId, (time) => ({
        ...time,
        sends: time.sends.filter((state) => state.busId !== busId),
    }));

    // The store update only removes the send from project truth — the live send
    // GainNode stays wired into the bus, so audio keeps summing to it after the
    // UI shows the send gone (and the stale path replicates to peers). Disconnect
    // it through the engine, mirroring setSend / toggleSendPreFader which also
    // pair the store write with the engine pass-through.
    let runtimeEffectFinalized = false;
    function finalizeRuntimeEffect(): void {
        if (runtimeEffectFinalized) {
            return;
        }
        engineRemoveSend(trackId, busId);
        runtimeEffectFinalized = true;
    }
    function reconcileRuntimeEffect(): void {
        const committedSend = getTrackById(trackId)?.sends.find((send) => send.busId === busId);
        if (committedSend) {
            engineSetSend(trackId, busId, committedSend.level, committedSend.preFader);
            return;
        }
        engineRemoveSend(trackId, busId);
    }
    if (options.deferRuntimeEffect) {
        return {
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: reconcileRuntimeEffect,
        };
    }
    finalizeRuntimeEffect();
    return true;
}
