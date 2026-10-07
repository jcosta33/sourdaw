import { exportCancellationState } from './exportCancellationState';

/** Whether an agent measurement holds the render lock and no musician's export is already waiting for it. */
export function canPreemptMeasurement(): boolean {
    return (
        exportCancellationState.renderLock?.holder === 'agent-measurement' &&
        exportCancellationState.queuedMusicianExport === null
    );
}
