import { separateStems as separateStemsWithAiEngine } from '../../repositories/separateStems';

export function separateStems(audioData: ArrayBuffer, stems: string[] = ['all']): Promise<Record<string, AudioBuffer>> {
    return separateStemsWithAiEngine(audioData, stems);
}
