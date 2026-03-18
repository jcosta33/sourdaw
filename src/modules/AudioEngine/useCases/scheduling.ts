/**
 * Use case for audio scheduling — metronome clicks, buffer playback, timing.
 *
 * All timing-sensitive operations go through here.
 */
import { audioEngine } from '../repositories/audioEngineInstance';

export const scheduleClick = (time: number, accent: boolean, volume = 1): void => {
    audioEngine.scheduleClick(time, accent, volume);
};

export const stopAllScheduled = (): void => {
    audioEngine.stopAllScheduled();
};

export const getCurrentTime = (): number => {
    return audioEngine.context.currentTime;
};

export const createBufferSource = (): AudioBufferSourceNode => {
    return audioEngine.context.createBufferSource();
};
