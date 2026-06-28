import { inject } from '#/infra/di/inject';
import { RuntimeLogger } from '#/infra/logger/runtimeLogger';
import { removeMidiFxFromStrip } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../updateTrack';

export const removeMidiFx = inject({ logger: RuntimeLogger })(
    ({ logger }) =>
        function removeMidiFx(trackId: string, fxId: string): void {
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
                logger.warn(`Failed to remove MIDI FX from engine: ${error}`);
            }
        }
);
