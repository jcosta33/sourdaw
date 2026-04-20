import { setSend as engineSetSend } from '#/modules/Routing/useCases';

import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';

export function setSend(trackId: string, busId: string, level: number, preFader = false): void {
    const track = getTrackById(trackId);
    const existingSend = track?.sends.find((s) => s.busId === busId);
    const resolvedPreFader = existingSend ? existingSend.preFader : preFader;

    updateTrack(trackId, (t) => {
        const existingIndex = t.sends.findIndex((s) => s.busId === busId);
        const sends = [...t.sends];
        if (existingIndex >= 0) {
            const existing = sends[existingIndex]!;
            sends[existingIndex] = { busId, level, preFader: existing.preFader };
        } else {
            sends.push({ busId, level, preFader });
        }
        return { ...t, sends };
    });

    engineSetSend(trackId, busId, level, resolvedPreFader);
}
