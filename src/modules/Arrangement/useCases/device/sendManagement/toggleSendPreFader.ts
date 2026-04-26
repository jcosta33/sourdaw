import { setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';

export function toggleSendPreFader(trackId: string, busId: string): void {
    const track = getTrackById(trackId);
    const send = track?.sends.find((state) => state.busId === busId);
    if (!send) {
        return;
    }

    const newPreFader = !send.preFader;

    updateTrack(trackId, (time) => ({
        ...time,
        sends: time.sends.map((state) => (state.busId === busId ? { ...state, preFader: newPreFader } : state)),
    }));

    engineSetSend(trackId, busId, send.level, newPreFader);
}
