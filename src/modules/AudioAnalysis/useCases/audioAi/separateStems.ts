import { separateStems as separateStemsWithAiEngine } from '../../repositories/audioAiEngine';

export function separateStems(
    audioData: ArrayBuffer,
    stems: string[] = ['all']
): Promise<Record<string, AudioBuffer>> {
    return separateStemsWithAiEngine(audioData, stems);
}