import { isAppError } from '#/infra/errors/isAppError';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { isTauri } from '#/utils/tauriRuntime';

import { createAiGenerationError } from '../../errors/AiGenerationError';
import { denoiseAudio } from '../nativeAiBridge/denoiseAudio';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

// The browser-fallback expander below is mirrored sample-for-sample by the
// native implementation in crates/sourdaw-native/src/commands/ai_audio.rs:
// the same Denoise action must render the same audio in every runtime.
// Change the two in lockstep. The curve, its invariants, and the pinned
// depth/THD numbers are documented there.
const EXPANSION_EXPONENT_SCALE = 5;
const ENVELOPE_ATTACK_SECONDS = 0.002;
const ENVELOPE_RELEASE_SECONDS = 0.1;

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

        if (isTauri()) {
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

            const output = new Float32Array(mono);
            const clampedStrength = Math.min(Math.max(strength, 0), 1);
            // Strength 0 is a bit-exact pass-through: the loop is skipped
            // rather than multiplying by a computed gain of 1.
            if (clampedStrength > 0) {
                const threshold = Math.sqrt(noisePower * (1 + clampedStrength * 3));
                const exponent = clampedStrength * EXPANSION_EXPONENT_SCALE;
                const attack = Math.exp(-1 / (ENVELOPE_ATTACK_SECONDS * buffer.sampleRate));
                const release = Math.exp(-1 / (ENVELOPE_RELEASE_SECONDS * buffer.sampleRate));
                // Gain is keyed by a smoothed level, not the instantaneous
                // sample, so sub-threshold material is attenuated rather
                // than waveshaped into harmonic distortion.
                let envelope = 0;
                for (let index = 0; index < output.length; index++) {
                    const abs = Math.abs(output[index]!);
                    const coefficient = abs > envelope ? attack : release;
                    envelope = abs + coefficient * (envelope - abs);
                    // False when the threshold is 0 (digitally silent
                    // analysis window), so silence passes through.
                    if (envelope < threshold) {
                        output[index] = output[index]! * (envelope / threshold) ** exponent;
                    }
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
