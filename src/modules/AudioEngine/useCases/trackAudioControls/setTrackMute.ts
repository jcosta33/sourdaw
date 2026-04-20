import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackMute(trackId: string, muted: boolean, restoreGain?: number): void {
    audioEngine.setTrackMute(trackId, muted, restoreGain);
}
