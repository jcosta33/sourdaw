import { removeSend as engineRemoveSend, setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';

/**
 * Puts the live send back to what the project holds, after a gesture previewed
 * on the engine and its commit failed or was refused.
 */
export function restoreSendEngineFromProjectTruth(trackId: string, busId: string): void {
    const committed = getTrackById(trackId)?.sends.find((send) => send.busId === busId);
    if (!committed) {
        engineRemoveSend(trackId, busId);
        return;
    }
    engineSetSend(trackId, busId, committed.level, committed.preFader);
}
