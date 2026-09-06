import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type ProjectSnapshot } from '../../../models/ProjectVersion';

import { getActiveCheckpointOwnerId } from './getActiveCheckpointOwnerId';

/**
 * Capture the current project state as a JSON snapshot.
 *
 * Note: Uses JSON.stringify — Map, Set, and typed arrays are not preserved.
 * Adequate for current store shapes which are plain objects.
 */
export function captureSnapshot(): ProjectSnapshot | null {
    const ownerProjectId = getActiveCheckpointOwnerId();
    if (!ownerProjectId) {
        return null;
    }

    const data = JSON.stringify({
        tracks: trackStore.value,
        markers: markerStore.value,
        transport: transportStore.value,
        midi: midiStore.value,
        automation: automationStore.value,
        timestamp: Date.now(),
    });
    // `new Blob([data]).size` just to measure UTF-8 byte length allocates an
    // entire Blob — use TextEncoder which is faster and allocation-light.
    const size = new TextEncoder().encode(data).byteLength;
    return { ownerProjectId, data, size };
}
