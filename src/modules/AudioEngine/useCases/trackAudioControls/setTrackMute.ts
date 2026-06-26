import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackMute(trackId: string, muted: boolean): void {
    audioEngine.setTrackMute(trackId, muted);
}
