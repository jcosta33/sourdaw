import { isAppError } from '#/infra/errors/isAppError';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { createAiGenerationError } from '../../errors/AiGenerationError';
import { denoiseAudio } from '../nativeAiBridge/denoiseAudio';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

export async function handleAiDenoiseClip(clipId: string, strength: number = 0.7) {
    const taskId = addTask({ type: 'denoise', status: 'processing' });
    try {
        const start = performance.now();
        const buffer = getCachedAudioBuffer({ bufferId: clipId });
        if (!buffer) {
            throw createAiGenerationError('Audio buffer not found for clip');
        }
        const denoisedBufferId = `${clipId}-denoised`;

        let outNoiseFloor = -60;

        if (isDesktopRuntime()) {
            const samples = buffer.getChannelData(0);
            const res = await denoiseAudio(samples, buffer.sampleRate, buffer.numberOfChannels, strength);
            outNoiseFloor = res.noise_floor_db;
            const ctx = new OfflineAudioContext(1, res.samples.length, buffer.sampleRate);
            const outBuffer = ctx.createBuffer(1, res.samples.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(res.samples);
            cacheAudioBuffer({ buffer: outBuffer, bufferId: denoisedBufferId });
        } else {
            const mono = buffer.getChannelData(0);
            const hop = 1024;
            const noiseSamples = Math.min(Math.floor((buffer.sampleRate * 0.5) / hop) * hop, mono.length);

            let noisePower = 0;
            for (let index = 0; index < noiseSamples; index++) {
                noisePower += mono[index]! * mono[index]!;
            }
            noisePower /= Math.max(noiseSamples, 1);
            outNoiseFloor = 10 * Math.log10(Math.max(noisePower, 1e-12));

            const threshold = Math.sqrt(noisePower * (1 + strength * 3));
            // Below-threshold expansion gain. At ratio = 0 the gain is `floorGain`
            // (deeper suppression as strength rises); it ramps linearly to exactly
            // 1.0 at ratio = 1, which is continuous with the unity passthrough above
            // the threshold — no gain step at the boundary (the old branch jumped
            // from state*(1 - strength) to state, an audible click).
            const floorGain = 1 - strength * 0.95;
            const output = new Float32Array(mono.length);
            for (let index = 0; index < mono.length; index++) {
                const state = mono[index]!;
                const abs = Math.abs(state);
                if (abs < threshold) {
                    const ratio = abs / threshold;
                    output[index] = state * (floorGain + (1 - floorGain) * ratio);
                } else {
                    output[index] = state;
                }
            }

            const outCtx = new OfflineAudioContext(1, output.length, buffer.sampleRate);
            const outBuffer = outCtx.createBuffer(1, output.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(output);
            cacheAudioBuffer({ buffer: outBuffer, bufferId: denoisedBufferId });
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, noiseFloorDb: outNoiseFloor },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, {
            status: 'error',
            data: { clipId, strength },
            error: (() => {
                if (isAppError(error)) {
                    return error.message;
                }
                if (error instanceof Error) {
                    return error.message;
                }
                return 'Denoise failed';
            })(),
        });
    }
}
