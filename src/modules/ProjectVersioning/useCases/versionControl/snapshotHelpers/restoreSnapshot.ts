import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { restoreMarkerSnapshot, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { restoreTransportSnapshot } from '#/modules/Transport/useCases';

import { type ProjectSnapshot } from '../../../models/ProjectVersion';

import { getActiveCheckpointOwnerId } from './getActiveCheckpointOwnerId';

type SnapshotRecord = Pick<ProjectSnapshot, 'data' | 'ownerProjectId'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readSnapshot(value: unknown): SnapshotRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const { data, ownerProjectId } = value;
    if (typeof data !== 'string' || typeof ownerProjectId !== 'string') {
        return null;
    }

    return { data, ownerProjectId };
}

/**
 * Restore a snapshot into the project stores.
 */
export const restoreSnapshot = inject({ logger })(
    ({ logger }) =>
        function restoreSnapshot(value: unknown): boolean {
            const snapshot = readSnapshot(value);
            const ownerProjectId = getActiveCheckpointOwnerId();
            if (!snapshot || !ownerProjectId || snapshot.ownerProjectId !== ownerProjectId || !snapshot.data) {
                return false;
            }

            let parsed: Record<string, unknown>;
            try {
                const candidate: unknown = JSON.parse(snapshot.data);
                if (!isRecord(candidate)) {
                    logger.warn('Snapshot data is not a valid object — skipping restore');
                    return false;
                }
                parsed = candidate;
            } catch (error) {
                logger.error(new Error('Corrupt snapshot — failed to parse', { cause: error }));
                return false;
            }

            const hasRestorableField = ['tracks', 'markers', 'transport', 'midi', 'automation'].some(
                (key) => parsed[key] !== null && parsed[key] !== undefined
            );
            if (!hasRestorableField) {
                return false;
            }

            if (parsed.tracks) {
                restoreTrackSnapshot(parsed.tracks);
            }
            if (parsed.markers) {
                restoreMarkerSnapshot(parsed.markers);
            }
            if (parsed.transport) {
                restoreTransportSnapshot(parsed.transport);
            }
            if (parsed.midi) {
                setMidiStoreState(parsed.midi);
            }
            if (parsed.automation) {
                restoreAutomationSnapshot(parsed.automation);
            }

            return true;
        }
);
