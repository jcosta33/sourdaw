import { isAppError } from '#/infra/errors/isAppError';
import { generateAudio, isAudioGenerationAvailable } from '#/modules/AudioAnalysis/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { createAiGenerationError } from '../../errors/AiGenerationError';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

/**
 * Single source of truth for the "audio generation requires the desktop app"
 * message. Both the fallback task path (here) and the `generateAudio` handler
 * (`handlers/aiMidi/handleGenerateAudioAiMidi.ts`) gate on the same condition;
 * keeping the wording in one place prevents the two call sites from drifting.
 */
export const AUDIO_GENERATION_UNAVAILABLE_MESSAGE =
    'Audio generation requires the Sourdaw desktop app (uses Stable Audio Open via Python sidecar)';

/**
 * Throws an `AiGenerationError` carrying {@link AUDIO_GENERATION_UNAVAILABLE_MESSAGE}
 * when the audio-generation sidecar is not available. Callers decide how to
 * surface the failure (error task vs. user toast).
 */
export function ensureAudioGenerationAvailable(): void {
    if (!isAudioGenerationAvailable()) {
        throw createAiGenerationError(AUDIO_GENERATION_UNAVAILABLE_MESSAGE);
    }
}

export async function handleGenerateAudioFallback(prompt: string, durationStr: string, _strength: number = 0.7) {
    const taskId = addTask({ type: 'audio-generation', status: 'processing', prompt });
    const start = performance.now();
    try {
        ensureAudioGenerationAvailable();

        const duration = parseInt(durationStr) || 8;
        const buffer = await generateAudio(prompt, duration);
        audioBufferCache.set(`generated-${crypto.randomUUID()}`, buffer);

        updateTask(taskId, {
            status: 'success',
            data: { format: 'wav', lengthSeconds: duration },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        let errorMessage: string;
        if (isAppError(error)) {
            errorMessage = error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = 'Generation failed';
        }
        updateTask(taskId, {
            status: 'error',
            error: errorMessage,
            durationMs: Math.round(performance.now() - start),
        });
    }
}
