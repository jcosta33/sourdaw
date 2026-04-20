import { removeMidiFxFromStrip } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../updateTrack';

export function removeMidiFx(trackId: string, fxId: string): void {
    updateTrack(trackId, (track) => {
        if (track.kind !== 'midi') {
            return track;
        }
        const nextMidiFx = track.midiFx?.filter((fx) => fx.id !== fxId) ?? [];
        return { ...track, midiFx: nextMidiFx };
    });

    try {
        removeMidiFxFromStrip(trackId, fxId);
    } catch (error) {
        console.warn(`Failed to remove MIDI FX from engine: ${error}`);
    }
}
