import { generateAudio as generateAudioWithAiEngine } from '../../repositories/generateAudio';

export function generateAudio(
    prompt: string,
    durationSeconds?: number,
    options?: { bpm?: number; key?: string; durationBars?: number }
): Promise<AudioBuffer> {
    return generateAudioWithAiEngine(prompt, durationSeconds, options);
}
