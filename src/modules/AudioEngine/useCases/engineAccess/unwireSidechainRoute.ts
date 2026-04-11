import { audioEngine } from '../../repositories/createWebAudioEngine';

export function unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
    audioEngine.unwireSidechainRoute(sourceTrackId, targetDeviceId);
}