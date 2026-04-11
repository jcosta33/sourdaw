import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getTrackStrip(trackId: string) {
    return audioEngine.getTrackStrip(trackId);
}