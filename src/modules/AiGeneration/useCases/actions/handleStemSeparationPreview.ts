import { isAppError } from '#/infra/errors/isAppError';
import { separateStems } from '#/modules/AudioAnalysis/useCases';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { audioBufferToWav } from '#/modules/AudioRendering/useCases';

import { createAiGenerationError } from '../../errors/AiGenerationError';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

export async function handleStemSeparationPreview(clipId: string) {
    const taskId = addTask({
        type: 'stem-separation',
        status: 'processing',
        prompt: 'Extracting: Drums, Bass, Vocals, Other',
    });
    const start = performance.now();
    try {
        const buffer = getCachedAudioBuffer({ bufferId: clipId });
        if (!buffer) {
            throw createAiGenerationError('Audio buffer not found for clip');
        }

        const wavData = await audioBufferToWav(buffer);
        const stemResults = await separateStems(wavData, ['all']);

        const stemNames = Object.keys(stemResults);
        for (const [name, stemBuffer] of Object.entries(stemResults)) {
            cacheAudioBuffer({ buffer: stemBuffer, bufferId: `${clipId}-${name}` });
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, stems: stemNames },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        let errorMessage: string;
        if (isAppError(error)) {
            errorMessage = error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = 'Stem separation failed';
        }
        updateTask(taskId, {
            status: 'error',
            error: errorMessage,
            durationMs: Math.round(performance.now() - start),
        });
    }
}
