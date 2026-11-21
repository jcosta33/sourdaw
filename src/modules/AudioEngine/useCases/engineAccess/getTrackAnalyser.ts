import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getTrackAnalyser(trackId: string): AnalyserNode | null {
    return audioEngine.getTrackStrip(trackId)?.analyserNode ?? null;
}
