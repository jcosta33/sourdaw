import { isAppError } from '#/infra/errors/isAppError';
import { generateAudio } from '#/modules/AudioAnalysis/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { addTask } from './addTask';
import { ensureAudioGenerationAvailable } from './ensureAudioGenerationAvailable';
import { updateTask } from './updateTask';

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
