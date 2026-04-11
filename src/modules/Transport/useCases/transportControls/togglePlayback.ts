import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';

export function togglePlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (state.isPlaying) {
        // Dynamic import to avoid circular dependency
        import('./pausePlayback').then(({ pausePlayback }) => pausePlayback());
    } else {
        import('./startPlayback').then(({ startPlayback }) => startPlayback());
    }
}
