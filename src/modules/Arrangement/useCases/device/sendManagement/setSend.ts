import { logger } from '#/infra/logger/appLogger';
import {
    getAllSidechainRoutes,
    removeSend as engineRemoveSend,
    setSend as engineSetSend,
} from '#/modules/Routing/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { getAllTracks } from '../../../repositories/track/getAllTracks';
import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../../stores/trackEligibility';

type SetSendOptions = {
    deferRuntimeEffect?: boolean;
};

type DeferredSendRuntimeEffect = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function setSend(trackId: string, busId: string, level: number, preFader?: boolean): boolean;
export function setSend(
    trackId: string,
    busId: string,
    level: number,
    preFader: boolean,
    options: { deferRuntimeEffect: true }
): DeferredSendRuntimeEffect | null;
export function setSend(
    trackId: string,
    busId: string,
    level: number,
    preFader = false,
    options: SetSendOptions = {}
): boolean | DeferredSendRuntimeEffect | null {
    const track = getTrackById(trackId);
    if (!track || !getTrackEligibility(track.kind).acceptsSend) {
        return false;
    }

    const targetTrack = getTrackById(busId);
    if (!targetTrack || !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return false;
    }

    // FX-2: a send that closes a routing loop is not merely invalid bookkeeping
    // — a Web Audio cycle containing no DelayNode is muted outright by the
    // spec's rendering algorithm, so the track and every node in the loop go
    // silent with no error at all. Reject before touching project truth or the
    // engine, so the invariant holds for every caller (matrix, mixer, AI action)
    // rather than only where a control happens to be greyed out.
    if (
        wouldCreateRoutingCycle({
            sourceId: trackId,
            targetId: busId,
            tracks: getAllTracks(),
            sidechainRoutes: getAllSidechainRoutes(),
        })
    ) {
        logger.warn(
            `[setSend] Rejected send ${trackId} → ${busId}: it would create a routing feedback loop. ` +
                'Route through a different bus, or remove the return path first.'
        );
        return false;
    }
    const existingSend = track?.sends.find((state) => state.busId === busId);
    const resolvedPreFader = existingSend ? existingSend.preFader : preFader;

    updateTrack(trackId, (time) => {
        const existingIndex = time.sends.findIndex((state) => state.busId === busId);
        const sends = [...time.sends];
        if (existingIndex >= 0) {
            const existing = sends[existingIndex]!;
            sends[existingIndex] = { busId, level, preFader: existing.preFader };
        } else {
            sends.push({ busId, level, preFader });
        }
        return { ...time, sends };
    });

    let runtimeEffectFinalized = false;
    function finalizeRuntimeEffect(): void {
        if (runtimeEffectFinalized) {
            return;
        }
        engineSetSend(trackId, busId, level, resolvedPreFader);
        runtimeEffectFinalized = true;
    }
    function reconcileRuntimeEffect(): void {
        const committedSend = getTrackById(trackId)?.sends.find((send) => send.busId === busId);
        if (!committedSend) {
            engineRemoveSend(trackId, busId);
            return;
        }
        engineSetSend(trackId, busId, committedSend.level, committedSend.preFader);
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
