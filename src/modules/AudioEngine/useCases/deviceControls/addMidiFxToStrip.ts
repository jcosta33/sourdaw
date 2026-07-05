import { audioEngine } from '../../repositories/createWebAudioEngine';

export function addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
    audioEngine.addMidiFxToStrip(trackId, fxId, fxType);
}
