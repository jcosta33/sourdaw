import { inject } from '#/infra/di/inject';
import { RuntimeLogger } from '#/infra/logger/runtimeLogger';
import { updateMidiFxBypass } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../updateTrack';

export const bypassMidiFx = inject({ logger: RuntimeLogger })(
    ({ logger }) =>
        function bypassMidiFx(trackId: string, fxId: string, bypassed: boolean): void {
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
        logger.warn(`Failed to bypass MIDI FX in engine: ${error}`);
    }
        }
);
