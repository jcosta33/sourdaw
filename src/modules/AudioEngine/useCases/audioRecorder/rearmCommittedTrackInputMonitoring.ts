import { logger } from '#/infra/logger/appLogger';

import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';

import { admitInputMonitoring } from './admitInputMonitoring';
import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/** Restore admission and its pending grant must both observe current committed intent. */
export async function rearmCommittedTrackInputMonitoring(trackId: string): Promise<void> {
    const track = readCommittedInputMonitoringTrack(trackId);
    if (!track || track.inputMonitoring !== 'on') {
        return;
    }
    reconcileAutoInputMonitoring();
    const readIntent = (): { inputId: string | null } | null => {
        const current = readCommittedInputMonitoringTrack(trackId);
        return current?.inputMonitoring === 'on' ? { inputId: current.inputId } : null;
    };
    // Permission belongs to the runtime owner; committed history must remain available while it waits.
    void admitInputMonitoring(trackId, undefined, readIntent).catch((error: unknown) => {
        logger.error(new Error(`Failed to rearm input monitoring on track ${trackId}`, { cause: error }));
    });
}
