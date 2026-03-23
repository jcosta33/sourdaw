import { getTrackById, updateTrack } from '../../repositories/trackRepository';
import { setSend as engineSetSend } from '#/modules/AudioEngine/useCases/busControls';

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

export function removeSend(trackId: string, busId: string): void {
    updateTrack(trackId, (t) => ({
        ...t,
        sends: t.sends.filter((s) => s.busId !== busId),
    }));
}
