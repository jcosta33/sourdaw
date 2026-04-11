import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type ProjectSnapshot } from '../../../models/ProjectVersion';

/**
 * Restore a snapshot into the project stores.
 */
export const restoreSnapshot = inject({ logger })(
    ({ logger }) =>
        (function restoreSnapshot(snapshot: ProjectSnapshot): void {
            try {
                const parsed = JSON.parse(snapshot.data);
                if (parsed.tracks) {
                    trackStore.set(parsed.tracks);
                }
                if (parsed.markers) {
                    markerStore.set(parsed.markers);
                }
                if (parsed.transport) {
                    transportStore.set(parsed.transport);
                }
            } catch (error) {
                logger.error(new Error('Corrupt snapshot — failed to parse', { cause: error }));
            }
        })
);