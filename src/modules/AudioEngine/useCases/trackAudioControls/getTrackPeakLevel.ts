import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getTrackPeakLevel(trackId: string): number {
    return audioEngine.getTrackPeakLevel(trackId);
}