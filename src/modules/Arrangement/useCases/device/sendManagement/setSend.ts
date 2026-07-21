import { setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../../stores/trackEligibility';

export function setSend(trackId: string, busId: string, level: number, preFader = false): boolean {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsSend) {
        return false;
    }

    const targetTrack = getTrackById(busId);
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
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

    engineSetSend(trackId, busId, level, resolvedPreFader);
    return true;
}
