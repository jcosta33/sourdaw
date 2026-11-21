import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * RT-5 companion to {@link scheduleTrackGain} for the track panner. `pan` is the
 * canonical −50..50 range (scaled to the panner's −1..1 internally); `time` is
 * the absolute, compensation-aligned AudioContext time.
 */
export function scheduleTrackPan(trackId: string, pan: number, time: number): void {
    audioEngine.scheduleTrackPan(trackId, pan, time);
}
