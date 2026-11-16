import { logger } from '#/infra/logger/appLogger';
import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';

import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';

import { admitInputMonitoring } from './admitInputMonitoring';
import { type ReadIntent } from './inputMonitoringAdmission';
import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/** Restore admission and its pending grant must both observe current committed intent. */
export function rearmCommittedTrackInputMonitoring(trackId: string): Promise<void> {
    // Callers settle each track's rearm independently, so a failure must reject rather than throw.
    return new Promise((resolve) => {
        rearmTrack(trackId);
        resolve();
    });
}

function rearmTrack(trackId: string): void {
    const track = readCommittedInputMonitoringTrack(trackId);
    if (!track || track.inputMonitoring !== 'on') {
        return;
    }
    reconcileAutoInputMonitoring();
    const readIntent: ReadIntent = () => {
        const current = readCommittedInputMonitoringTrack(trackId);
        if (current?.inputMonitoring !== 'on' || !getTrackEligibility(current.kind).acceptsMonitoring) {
            return null;
        }
        return {
            inputId: current.inputId,
            inputMonitoring: 'on',
            canAttach: trackStore.value?.tracks.some((track) => track.id === trackId) === true,
        };
    };
    // Permission belongs to the runtime owner; committed history must remain available while it waits.
    void admitInputMonitoring(trackId, undefined, readIntent).catch((error: unknown) => {
        logger.error(new Error(`Failed to rearm input monitoring on track ${trackId}`, { cause: error }));
    });
}
