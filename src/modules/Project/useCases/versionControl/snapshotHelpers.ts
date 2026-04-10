import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, markerStore } from '#/modules/Arrangement';
import { transportStore } from '#/modules/Transport';
import { type ProjectSnapshot } from '../../models/ProjectVersion';

/**
 * Capture the current project state as a JSON snapshot.
 *
 * Note: Uses JSON.stringify — Map, Set, and typed arrays are not preserved.
 * Adequate for current store shapes which are plain objects.
 */
export function captureSnapshot(): ProjectSnapshot {
    const data = JSON.stringify({
        tracks: trackStore.value,
        markers: markerStore.value,
        transport: transportStore.value,
        timestamp: Date.now(),
    });
    return { data, size: new Blob([data]).size };
}

/**
 * Restore a snapshot into the project stores.
 */
export const restoreSnapshot = inject({ logger })(
    ({ logger }) =>
        function restoreSnapshot(snapshot: ProjectSnapshot): void {
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
        }
);
