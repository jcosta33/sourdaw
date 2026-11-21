import { inject } from '#/infra/di/inject';

import { audioEngine } from './getAudioContext';

/** Starts a new Chrome playback-latency measurement window. */
export const resetEnginePlaybackLatencyStats = inject({ audioEngine })(
    ({ audioEngine }) =>
        function resetEnginePlaybackLatencyStats(): void {
            audioEngine.resetPlaybackLatencyStats();
        }
);
