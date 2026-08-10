import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Schedule an automation level on an existing send at an absolute AudioContext
 * time. The caller owns musical-time projection and PDC compensation; the audio
 * engine owns the exact pre/post-tap GainNode and its a-rate ramp.
 */
export function scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void {
    audioEngine.scheduleSendAutomation(sourceTrackId, busId, level, time);
}
