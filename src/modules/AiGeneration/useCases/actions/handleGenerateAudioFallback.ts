import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export async function handleGenerateAudioFallback(prompt: string, durationStr: string, _strength: number = 0.7) {
    const taskId = addTask({ type: 'audio-generation', status: 'processing', prompt });
    try {
        const start = performance.now();

        const { generateAudio, isAudioGenerationAvailable } = await import('#/modules/AudioAnalysis/useCases/audioAi');
        if (!isAudioGenerationAvailable()) {
            throw new Error(
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
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
    }
}
