import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setSend(sourceTrackId: string, busId: string, level: number, preFader: boolean): void {
    audioEngine.setSend(sourceTrackId, busId, level, preFader);
}
