import { exportCancellationState } from './exportCancellationState';

export function cancelExport(): void {
    exportCancellationState.cancelFlag = true;
    // The scope's signal is what lets an awaited fetch inside instrument setup
    // stop now (#4440); the flag alone was only read between tracks.
    exportCancellationState.controller.abort();
    // An export still waiting for a measurement to release stops waiting.
    exportCancellationState.queuedMusicianExport?.abort();
}
