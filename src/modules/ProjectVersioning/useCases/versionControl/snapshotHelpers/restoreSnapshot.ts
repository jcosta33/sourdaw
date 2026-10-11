import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { markerStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { restoreArrangementMetadataSnapshot, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import { restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { timeSignatureMapStore } from '#/modules/Transport/stores';
import { restoreTimelineMapSnapshot, restoreTransportSnapshot } from '#/modules/Transport/useCases';

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

            // A payload written before #5108 carries no tempoMap or takeLanes.
            // The omission is tolerated: those fields restore only when the
            // payload carries them, so an old snapshot never invents historical
            // tempo or comp state and the live timeline state stands.
            const hasRestorableField = [
                'tracks',
                'markers',
                'transport',
                'midi',
                'automation',
                'tempoMap',
                'takeLanes',
            ].some((key) => parsed[key] !== null && parsed[key] !== undefined);
            if (!hasRestorableField) {
                return false;
            }

            if (parsed.tempoMap) {
                // Restored before the transport so a playing reposition reads
                // the version's map, not the pre-restore one. The legacy
                // snapshot never captured time signatures, so the live map is
                // held — the tempo-map restore must not invent or erase them.
                restoreTimelineMapSnapshot({
                    tempoMap: parsed.tempoMap,
                    timeSignatureMap: timeSignatureMapStore.value ?? undefined,
                });
            }
            if (parsed.tracks) {
                restoreTrackSnapshot(parsed.tracks);
            }
            if (parsed.markers || parsed.takeLanes) {
                // The metadata route writes both sections; a field the payload
                // omits holds its live state so it survives untouched.
                restoreArrangementMetadataSnapshot({
                    markers: parsed.markers ?? markerStore.value ?? undefined,
                    takeLanes: parsed.takeLanes ?? takeLaneStore.value ?? undefined,
                });
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
