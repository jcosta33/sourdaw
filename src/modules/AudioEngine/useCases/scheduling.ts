/**
 * Use case for audio scheduling — metronome clicks, buffer playback, timing.
 *
 * All timing-sensitive operations go through here.
 */
import { audioEngine } from '../repositories/createWebAudioEngine';

export function scheduleClick(time: number, accent: boolean, volume = 1): void {
    audioEngine.scheduleClick(time, accent, volume);
}

export function stopAllScheduled(): void {
    audioEngine.stopAllScheduled();
}

export function getCurrentTime(): number {
    return audioEngine.context.currentTime;
}

export function createBufferSource(): AudioBufferSourceNode {
    return audioEngine.context.createBufferSource();
}
