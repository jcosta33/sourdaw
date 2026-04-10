import { inject } from '#/infra/di/inject';
import { createAiGenerationError } from '../../errors/AiGenerationError';
import { isAppError } from '#/infra/errors/isAppError';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { generateAudio, isAudioGenerationAvailable } from '#/modules/AudioAnalysis/useCases/audioAi';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export const handleGenerateAudioFallbackDependencies = {
    addTask,
    updateTask,
    generateAudio,
    isAudioGenerationAvailable,
} as const;

export const handleGenerateAudioFallback = inject(handleGenerateAudioFallbackDependencies)(
    ({ addTask, updateTask, generateAudio, isAudioGenerationAvailable }) =>
        async function handleGenerateAudioFallback(prompt: string, durationStr: string, _strength: number = 0.7) {
            const taskId = addTask({ type: 'audio-generation', status: 'processing', prompt });
            try {
                const start = performance.now();

                if (!isAudioGenerationAvailable()) {
                    throw createAiGenerationError(
                        'Audio generation requires the Sourdaw desktop app (uses Stable Audio Open via Python sidecar)'
                    );
                }

                const duration = parseInt(durationStr) || 8;
                const buffer = await generateAudio(prompt, duration);
                audioBufferCache.set(`generated-${crypto.randomUUID()}`, buffer);

                updateTask(taskId, {
                    status: 'success',
                    data: { format: 'wav', lengthSeconds: duration },
                    durationMs: Math.round(performance.now() - start),
                });
            } catch (error: unknown) {
                updateTask(taskId, {
                    status: 'error',
                    error: isAppError(error)
                        ? error.message
                        : error instanceof Error
                          ? error.message
                          : 'Generation failed',
                });
            }
        }
);
