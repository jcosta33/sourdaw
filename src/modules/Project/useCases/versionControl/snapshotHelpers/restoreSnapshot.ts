import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type ProjectSnapshot } from '../../../models/ProjectVersion';

/**
 * Restore a snapshot into the project stores.
 */
export const restoreSnapshot = inject({ logger })(
    ({ logger }) =>
        function restoreSnapshot(snapshot: ProjectSnapshot): void {
            try {
                const parsed = JSON.parse(snapshot.data);
                if (typeof parsed !== 'object' || parsed === null) {
                    logger.warn('Snapshot data is not a valid object — skipping restore');
                    return;
                }
                if (parsed.tracks) {
                    trackStore.set({
                        ...parsed.tracks,
                        tracks: (parsed.tracks.tracks ?? []).map(normalizeTrack),
                    });
                }
                if (parsed.markers) {
                    markerStore.set(parsed.markers);
                }
                if (parsed.transport) {
                    transportStore.set(parsed.transport);
                }
                if (parsed.midi) {
                    midiStore.set(parsed.midi);
                }
                if (parsed.automation) {
                    automationStore.set(parsed.automation);
                }
            } catch (error) {
                logger.error(new Error('Corrupt snapshot — failed to parse', { cause: error }));
            }
        }
);
