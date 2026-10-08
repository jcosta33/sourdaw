import { exportCancellationState } from './exportCancellationState';

/**
 * A musician's Cancel stops a musician's export and nothing else. The shared flag and scope are
 * raised only while an export of theirs holds the render lock; an agent render holding it, or no
 * render at all, leaves them down, so the flag can neither stop an assistant's render nor wait for a
 * later one. An agent render stops on its own signal or a musician export's preemption.
 */
export function cancelExport(): void {
    // An export still waiting for an agent render to release stops waiting.
    exportCancellationState.queuedMusicianExport?.abort();
    if (exportCancellationState.renderLock?.holder !== 'musician-export') {
        return;
    }
    exportCancellationState.cancelFlag = true;
    // The scope's signal is what lets an awaited fetch inside instrument setup
    // stop now (#4440); the flag alone was only read between tracks.
    exportCancellationState.controller.abort();
}
