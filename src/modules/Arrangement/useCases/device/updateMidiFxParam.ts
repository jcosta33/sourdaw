import { inject } from '#/infra/di/inject';
import { RuntimeLogger } from '#/infra/logger/runtimeLogger';
import { updateMidiFxParam as engineUpdateMidiFxParam } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../updateTrack';

export const updateMidiFxParam = inject({ logger: RuntimeLogger })(
    ({ logger }) =>
        function updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
            updateTrack(trackId, (track) => {
                if (track.kind !== 'midi') {
                    return track;
                }
                const nextMidiFx =
                    track.midiFx?.map((fx) =>
                        fx.id === fxId ? { ...fx, parameterValues: { ...fx.parameterValues, [paramId]: value } } : fx
                    ) ?? [];
                return { ...track, midiFx: nextMidiFx };
            });

            try {
                engineUpdateMidiFxParam(trackId, fxId, paramId, value);
            } catch (error) {
                logger.warn(`Failed to update MIDI FX param in engine: ${error}`);
            }
        }
);
