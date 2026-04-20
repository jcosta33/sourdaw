import { audioEngine } from '../../repositories/createWebAudioEngine';

export function ensureTrackStrip(trackId: string) {
    return audioEngine.ensureTrackStrip(trackId);
}
