import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { midiLearnStore, type LearningTarget } from '../../stores/midiLearnStore';

export const startMidiLearn = inject({ logger })(
    ({ logger }) =>
        (function startMidiLearn(target: LearningTarget): void {
            const state = midiLearnStore.value;
            if (!state) {
                return;
            }

            logger.info(`MIDI Learn started for ${target.targetType} on track ${target.trackId}`);

            midiLearnStore.set({
                ...state,
                isLearning: true,
                learningTarget: target,
            });
        })
);