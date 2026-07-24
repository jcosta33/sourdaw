import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * RT-5 live-automation write for the track fader gain. `time` is the absolute
 * AudioContext time the value should be heard — the caller has already added the
 * track's `getCompensationDelay`, so the automation lands on the same delayed
 * clock as the compensated audio it shapes. The engine ramps the real
 * `GainNode.gain` AudioParam a-rate rather than stepping at the scheduler grain.
 */
export function scheduleTrackGain(trackId: string, gain: number, time: number): void {
    audioEngine.scheduleTrackGain(trackId, gain, time);
}
