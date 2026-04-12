import { createAiGenerationError } from '../../errors/AiGenerationError';
import { isAppError } from '#/infra/errors/isAppError';
import { separateStems } from '#/modules/AudioAnalysis/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { audioBufferToWav } from '#/modules/AudioEngine/useCases';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export async function handleStemSeparationPreview(clipId: string) {
    const taskId = addTask({
        type: 'stem-separation',
        status: 'processing',
        prompt: 'Extracting: Drums, Bass, Vocals, Other',
    });
    try {
        const start = performance.now();

        const buffer = audioBufferCache.get(clipId);
        if (!buffer) {
            throw createAiGenerationError('Audio buffer not found for clip');
        }

        const wavData = await audioBufferToWav(buffer);
        const stemResults = await separateStems(wavData, ['all']);

        const stemNames = Object.keys(stemResults);
        for (const [name, stemBuffer] of Object.entries(stemResults)) {
            audioBufferCache.set(`${clipId}-${name}`, stemBuffer);
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, stems: stemNames },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, {
            status: 'error',
            error: isAppError(error)
                ? error.message
                : error instanceof Error
                  ? error.message
                  : 'Stem separation failed',
        });
    }
}
