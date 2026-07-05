import { audioEngine } from '../../repositories/createWebAudioEngine';

export function removeMidiFxFromStrip(trackId: string, fxId: string): void {
    audioEngine.removeMidiFxFromStrip(trackId, fxId);
}
