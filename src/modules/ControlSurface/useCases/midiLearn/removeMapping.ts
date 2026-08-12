import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { midiLearnStore } from '../../stores/midiLearnStore';

/**
 * Remove one learned MIDI mapping by id (F-10).
 *
 * Before this, the only deletion path was the panic `clearAllMappings`,
 * forcing a user who mis-bound a single control to discard every mapping to
 * fix it.
 */
export const removeMapping = inject({ logger })(
    ({ logger }) =>
        function removeMapping(mappingId: string): void {
            const state = midiLearnStore.value;
            if (!state) {
                return;
            }

            const mappings = state.mappings.filter((mapping) => mapping.id !== mappingId);
            if (mappings.length === state.mappings.length) {
                return;
            }

            logger.info(`MIDI Learn: removed mapping ${mappingId}`);

            midiLearnStore.set({ ...state, mappings });
        }
);
