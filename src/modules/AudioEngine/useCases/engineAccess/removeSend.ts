import { audioEngine } from '../../repositories/createWebAudioEngine';

export function removeSend(sourceTrackId: string, busId: string): void {
    audioEngine.removeSend(sourceTrackId, busId);
}
