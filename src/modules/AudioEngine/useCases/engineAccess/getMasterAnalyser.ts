import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getMasterAnalyser(): AnalyserNode {
    return audioEngine.masterAnalyser;
}