import { audioEngine } from '../../repositories/createWebAudioEngine';

export function updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
    audioEngine.updateMidiFxBypass(trackId, fxId, bypassed);
}
