import { isAppError } from '#/infra/errors/isAppError';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { isDesktopRuntime } from '#/utils/desktopRuntime';

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

function concatenateChannels(buffer: AudioBuffer): Float32Array {
    const samples = new Float32Array(buffer.length * buffer.numberOfChannels);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        samples.set(buffer.getChannelData(channel), channel * buffer.length);
    }
    return samples;
}

function createPlanarAudioBuffer(samples: Float32Array, channels: number, frames: number, sampleRate: number) {
    if (samples.length !== channels * frames) {
        throw createAiGenerationError('Denoise returned an invalid channel layout');
    }

    const context = new OfflineAudioContext(channels, frames, sampleRate);
    const buffer = context.createBuffer(channels, frames, sampleRate);
    for (let channel = 0; channel < channels; channel++) {
        const channelStart = channel * frames;
        buffer.getChannelData(channel).set(samples.subarray(channelStart, channelStart + frames));
    }
    return buffer;
}

function estimateNoisePower(buffer: AudioBuffer): number {
    const hop = 1024;
    const noiseFrames = Math.min(Math.floor((buffer.sampleRate * 0.5) / hop) * hop, buffer.length);
    let noisePower = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let frame = 0; frame < noiseFrames; frame++) {
            noisePower += samples[frame]! * samples[frame]!;
        }
    }
    return noisePower / Math.max(noiseFrames * buffer.numberOfChannels, 1);
}

function expandChannel(samples: Float32Array, threshold: number, strength: number, sampleRate: number) {
    const output = new Float32Array(samples);
    if (strength === 0) {
        return output;
    }

    const exponent = strength * EXPANSION_EXPONENT_SCALE;
    const attack = Math.exp(-1 / (ENVELOPE_ATTACK_SECONDS * sampleRate));
    const release = Math.exp(-1 / (ENVELOPE_RELEASE_SECONDS * sampleRate));
    // Gain is keyed by a smoothed level, not the instantaneous sample, so
    // sub-threshold material is attenuated rather than waveshaped.
    let envelope = 0;
    for (let frame = 0; frame < output.length; frame++) {
        const abs = Math.abs(output[frame]!);
        const coefficient = abs > envelope ? attack : release;
        envelope = abs + coefficient * (envelope - abs);
        // False when the threshold is 0 (digitally silent analysis window),
        // so silence passes through.
        if (envelope < threshold) {
            output[frame] = output[frame]! * (envelope / threshold) ** exponent;
        }
    }
    return output;
}

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
            const samples = concatenateChannels(buffer);
            const res = await denoiseAudio(samples, buffer.sampleRate, buffer.numberOfChannels, strength);
            outNoiseFloor = res.noise_floor_db;
            const outBuffer = createPlanarAudioBuffer(
                res.samples,
                buffer.numberOfChannels,
                buffer.length,
                buffer.sampleRate
            );
            cacheAudioBuffer({ buffer: outBuffer, bufferId: denoisedBufferId });
        } else {
            const noisePower = estimateNoisePower(buffer);
            outNoiseFloor = 10 * Math.log10(Math.max(noisePower, 1e-12));

            const clampedStrength = Math.min(Math.max(strength, 0), 1);
            const threshold = Math.sqrt(noisePower * (1 + clampedStrength * 3));
            const output = new Float32Array(buffer.length * buffer.numberOfChannels);
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const expanded = expandChannel(
                    buffer.getChannelData(channel),
                    threshold,
                    clampedStrength,
                    buffer.sampleRate
                );
                output.set(expanded, channel * buffer.length);
            }

            const outBuffer = createPlanarAudioBuffer(
                output,
                buffer.numberOfChannels,
                buffer.length,
                buffer.sampleRate
            );
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
