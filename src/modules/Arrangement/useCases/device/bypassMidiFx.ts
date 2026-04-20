import { updateMidiFxBypass } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../updateTrack';

export function bypassMidiFx(trackId: string, fxId: string, bypassed: boolean): void {
    updateTrack(trackId, (track) => {
        if (track.kind !== 'midi') {
            return track;
        }
        const nextMidiFx = track.midiFx?.map((fx) => (fx.id === fxId ? { ...fx, bypassed } : fx)) ?? [];
        return { ...track, midiFx: nextMidiFx };
    });

    try {
        updateMidiFxBypass(trackId, fxId, bypassed);
    } catch (error) {
        console.warn(`Failed to bypass MIDI FX in engine: ${error}`);
    }
}
