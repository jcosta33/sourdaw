import { audioEngine } from '../../repositories/createWebAudioEngine';

export function addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
    audioEngine.addMidiFxToStrip(trackId, fxId, fxType);
}

export function removeMidiFxFromStrip(trackId: string, fxId: string): void {
    audioEngine.removeMidiFxFromStrip(trackId, fxId);
}

export function updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
    audioEngine.updateMidiFxParam(trackId, fxId, paramId, value);
}

export function updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
    audioEngine.updateMidiFxBypass(trackId, fxId, bypassed);
}
