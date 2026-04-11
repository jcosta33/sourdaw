import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { midiLearnStore } from '../../stores/midiLearnStore';

export const stopMidiLearn = inject({ logger })(
    ({ logger }) =>
        (function stopMidiLearn(): void {
            const state = midiLearnStore.value;
            if (!state) {
                return;
            }

            logger.info('MIDI Learn cancelled');

            midiLearnStore.set({
                ...state,
                isLearning: false,
                learningTarget: null,
            });
        })
);