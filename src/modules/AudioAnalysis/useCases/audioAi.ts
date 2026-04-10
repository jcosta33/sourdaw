import {
    isStemSeparationAvailable as checkStemSeparationAvailability,
    isAudioGenerationAvailable as checkAudioGenerationAvailability,
    isAudioAiServerRunning as checkAudioAiServerStatus,
    generateAudio as generateAudioWithAiEngine,
    separateStems as separateStemsWithAiEngine,
} from '../repositories/audioAiEngine';

/**
 * Public contract for AudioAnalysis AI engine operations.
 */
export function isStemSeparationAvailable(): boolean {
    return checkStemSeparationAvailability();
}

export function isAudioGenerationAvailable(): boolean {
    return checkAudioGenerationAvailability();
}

export function isAudioAiServerRunning(): Promise<boolean> {
    return checkAudioAiServerStatus();
}

export function generateAudio(
    prompt: string,
    durationSeconds?: number,
    options?: { bpm?: number; key?: string; durationBars?: number }
): Promise<AudioBuffer> {
    return generateAudioWithAiEngine(prompt, durationSeconds, options);
}

export function separateStems(
    audioData: ArrayBuffer,
    stems: string[] = ['all']
): Promise<Record<string, AudioBuffer>> {
    return separateStemsWithAiEngine(audioData, stems);
}
