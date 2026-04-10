import { createAiGenerationError } from '../../errors/AiGenerationError';
import { isAppError } from '#/infra/errors/isAppError';
import { audioBufferCache, denoiseAudio, isTauri } from '#/modules/AudioEngine';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export async function handleAiDenoiseClip(clipId: string, strength: number = 0.7) {
    const taskId = addTask({ type: 'denoise', status: 'processing' });
    try {
        const start = performance.now();
        const buffer = audioBufferCache.get(clipId);
        if (!buffer) {
            throw createAiGenerationError('Audio buffer not found for clip');
        }

        let outNoiseFloor = -60;

        if (isTauri()) {
            const samples = buffer.getChannelData(0);
            const res = await denoiseAudio(samples, buffer.sampleRate, buffer.numberOfChannels, strength);
            outNoiseFloor = res.noise_floor_db;
            const ctx = new OfflineAudioContext(1, res.samples.length, buffer.sampleRate);
            const outBuffer = ctx.createBuffer(1, res.samples.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(res.samples);
            audioBufferCache.set(`${clipId}-denoised`, outBuffer);
        } else {
            const mono = buffer.getChannelData(0);
            const hop = 1024;
            const noiseSamples = Math.min(Math.floor((buffer.sampleRate * 0.5) / hop) * hop, mono.length);

            let noisePower = 0;
            for (let i = 0; i < noiseSamples; i++) {
                noisePower += (mono[i] ?? 0) * (mono[i] ?? 0);
            }
            noisePower /= Math.max(noiseSamples, 1);
            outNoiseFloor = 10 * Math.log10(Math.max(noisePower, 1e-12));

            const threshold = Math.sqrt(noisePower * (1 + strength * 3));
            const output = new Float32Array(mono.length);
            for (let i = 0; i < mono.length; i++) {
                const s = mono[i] ?? 0;
                const abs = Math.abs(s);
                if (abs < threshold) {
                    const ratio = abs / threshold;
                    output[i] = s * (ratio * (1 - strength) + (1 - ratio) * 0.05);
                } else {
                    output[i] = s;
                }
            }

            const outCtx = new OfflineAudioContext(1, output.length, buffer.sampleRate);
            const outBuffer = outCtx.createBuffer(1, output.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(output);
            audioBufferCache.set(`${clipId}-denoised`, outBuffer);
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, noiseFloorDb: outNoiseFloor },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, {
            status: 'error',
            error: isAppError(error) ? error.message : error instanceof Error ? error.message : 'Denoise failed',
        });
    }
}
