import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { setSend as engineSetSend } from '#/modules/Routing/useCases';

export function toggleSendPreFader(trackId: string, busId: string): void {
    const track = getTrackById(trackId);
    const send = track?.sends.find((s) => s.busId === busId);
    if (!send) {
        return;
    }

    const newPreFader = !send.preFader;

    updateTrack(trackId, (t) => ({
        ...t,
        sends: t.sends.map((s) => (s.busId === busId ? { ...s, preFader: newPreFader } : s)),
    }));

    engineSetSend(trackId, busId, send.level, newPreFader);
}