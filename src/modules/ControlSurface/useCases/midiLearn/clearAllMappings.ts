import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { midiLearnStore } from '../../stores/midiLearnStore';

/**
 * Remove every MIDI Learn mapping in one shot and cancel any in-progress learn.
 *
 * This is the panic / recovery path: if a controller starts driving the wrong
 * targets (e.g. after loading someone else's mappings, or a stuck CC), the user
 * needs a single action that returns the mapping table to empty without having
 * to clear each binding by hand. Learning state is also reset so a stale
 * `learningTarget` can't capture the next incoming CC.
 */
export const clearAllMappings = inject({ logger })(
    ({ logger }) =>
        function clearAllMappings(): void {
            const state = midiLearnStore.value;
            if (!state) {
                return;
            }

            if (state.mappings.length === 0 && !state.isLearning && state.learningTarget === null) {
                return;
            }

            logger.info(`MIDI Learn: cleared ${state.mappings.length} mapping(s)`);

            midiLearnStore.set({
                ...state,
                mappings: [],
                isLearning: false,
                learningTarget: null,
            });
        }
);
