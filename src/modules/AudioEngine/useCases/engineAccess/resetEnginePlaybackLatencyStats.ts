import { audioEngine } from './getAudioContext';

/** Starts a new Chrome playback-latency measurement window. */
export function resetEnginePlaybackLatencyStats(): void {
    audioEngine.resetPlaybackLatencyStats();
}
