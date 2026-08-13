import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { midiLearnStore, type LearningTarget } from '../../stores/midiLearnStore';

import { stopMidiLearn } from './stopMidiLearn';

/**
 * An armed learn that receives no CC within this window auto-cancels (F-10).
 * Without a timeout, a stray right-click leaves the next unrelated CC message
 * silently captured by a stale target, with no way to notice short of
 * checking every knob for the "listening" state.
 */
export const MIDI_LEARN_TIMEOUT_MS = 10_000;

// Monotonically increasing so a stale timeout from an earlier `startMidiLearn`
// call can tell it is stale — armed once a newer learn session (for the same
// or a different target) has already started — and skip cancelling it.
let learnGeneration = 0;

export const startMidiLearn = inject({ logger })(
    ({ logger }) =>
        function startMidiLearn(target: LearningTarget): void {
            const state = midiLearnStore.value;
            if (!state) {
                return;
            }

            logger.info(`MIDI Learn started for ${target.targetType} on track ${target.trackId ?? 'none'}`);

            midiLearnStore.set({
                ...state,
                isLearning: true,
                learningTarget: target,
            });

            learnGeneration += 1;
            const generation = learnGeneration;
            setTimeout(() => {
                if (generation !== learnGeneration) {
                    return;
                }
                if (midiLearnStore.value?.isLearning) {
                    stopMidiLearn();
                }
            }, MIDI_LEARN_TIMEOUT_MS);
        }
);
