import { getTransportState } from '#/modules/Transport/repositories/transportRepository';

export function togglePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (state.isPlaying) {
        // Dynamic import to avoid circular dependency
        void import('./pausePlayback').then(({ pausePlayback }) => pausePlayback());
    } else {
        void import('./startPlayback').then(({ startPlayback }) => startPlayback());
    }
}
