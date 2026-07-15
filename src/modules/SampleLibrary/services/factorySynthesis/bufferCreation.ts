import { SAMPLE_RATE } from './constants';

import type { MonoBuffer, StereoBuffer } from './types';

export function createMono(durationSec: number, sampleRate: number = SAMPLE_RATE): MonoBuffer {
    return new Float32Array(Math.max(1, Math.ceil(durationSec * sampleRate)));
}

export function createStereo(durationSec: number, sampleRate: number = SAMPLE_RATE): StereoBuffer {
    const len = Math.max(1, Math.ceil(durationSec * sampleRate));
    return [new Float32Array(len), new Float32Array(len)];
}

export function toAudioBufferMono(ctx: AudioContext, data: MonoBuffer, sampleRate: number = SAMPLE_RATE): AudioBuffer {
    const buf = ctx.createBuffer(1, data.length, sampleRate);
    buf.getChannelData(0).set(data);
    return buf;
}

export function toAudioBufferStereo(
    ctx: AudioContext,
    data: StereoBuffer,
    sampleRate: number = SAMPLE_RATE
): AudioBuffer {
    const buf = ctx.createBuffer(2, data[0].length, sampleRate);
    buf.getChannelData(0).set(data[0]);
    buf.getChannelData(1).set(data[1]);
    return buf;
}
