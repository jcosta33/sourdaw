import { audioEngine } from '../../repositories/createWebAudioEngine';

export function updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
    audioEngine.updateMidiFxParam(trackId, fxId, paramId, value);
}
