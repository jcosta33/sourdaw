import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { restoreMarkerSnapshot, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { restoreTransportSnapshot } from '#/modules/Transport/useCases';

import { type ProjectSnapshot } from '../../../models/ProjectVersion';

/**
 * Restore a snapshot into the project stores.
 */
export const restoreSnapshot = inject({ logger })(
    ({ logger }) =>
        function restoreSnapshot(snapshot: ProjectSnapshot): void {
            try {
                const parsed: unknown = JSON.parse(snapshot.data);
                if (typeof parsed !== 'object' || parsed === null) {
                    logger.warn('Snapshot data is not a valid object — skipping restore');
                    return;
                }
                if ('tracks' in parsed && parsed.tracks) {
                    restoreTrackSnapshot(parsed.tracks);
                }
                if ('markers' in parsed && parsed.markers) {
                    restoreMarkerSnapshot(parsed.markers);
                }
                if ('transport' in parsed && parsed.transport) {
                    restoreTransportSnapshot(parsed.transport);
                }
                if ('midi' in parsed && parsed.midi) {
                    setMidiStoreState(parsed.midi);
                }
                if ('automation' in parsed && parsed.automation) {
                    restoreAutomationSnapshot(parsed.automation);
                }
            } catch (error) {
                logger.error(new Error('Corrupt snapshot — failed to parse', { cause: error }));
            }
        }
);
