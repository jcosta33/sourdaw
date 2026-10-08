import { exportCancellationState } from './exportCancellationState';

/** Whether an agent render holds the render lock and no musician's export is already waiting for it. */
export function canPreemptAgentRender(): boolean {
    const holder = exportCancellationState.renderLock?.holder;
    return (
        holder !== undefined && holder !== 'musician-export' && exportCancellationState.queuedMusicianExport === null
    );
}
