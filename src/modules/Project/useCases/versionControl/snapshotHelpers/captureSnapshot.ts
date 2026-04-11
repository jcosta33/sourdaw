import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type ProjectSnapshot } from '../../../models/ProjectVersion';

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