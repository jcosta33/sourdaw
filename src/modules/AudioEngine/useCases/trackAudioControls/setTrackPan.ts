import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackPan(trackId: string, pan: number): void {
    audioEngine.setTrackPan(trackId, pan);
}
