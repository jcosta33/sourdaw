import { audioEngine } from '../../repositories/createWebAudioEngine';

export function scheduleClick(time: number, accent: boolean, volume = 1): void {
    audioEngine.scheduleClick(time, accent, volume);
}
