import { setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../../stores/trackEligibility';

export function toggleSendPreFader(trackId: string, busId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    const send = track.sends.find((state) => state.busId === busId);
    if (!send) {
        return;
    }
    if (!getTrackEligibility(track.kind).acceptsSend) {
        return;
    }

    const targetTrack = getTrackById(busId);
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return;
    }

    const newPreFader = !send.preFader;

    updateTrack(trackId, (time) => ({
        ...time,
        sends: time.sends.map((state) => (state.busId === busId ? { ...state, preFader: newPreFader } : state)),
    }));

    engineSetSend(trackId, busId, send.level, newPreFader);
}
