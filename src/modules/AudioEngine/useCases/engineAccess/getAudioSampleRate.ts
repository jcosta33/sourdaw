import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getAudioSampleRate(): number {
    return audioEngine.context?.sampleRate ?? 44100;
}
