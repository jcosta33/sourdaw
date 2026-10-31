import { type RenderedFactorySample } from '../models/RenderedFactorySample';

import { SAMPLE_RATE } from './constants';

import type { MonoBuffer, StereoBuffer } from './types';

type RenderedPcm = Pick<RenderedFactorySample, 'channels' | 'sampleRate'>;

export function createMono(durationSec: number, sampleRate: number = SAMPLE_RATE): MonoBuffer {
    return new Float32Array(Math.max(1, Math.ceil(durationSec * sampleRate)));
}

export function createStereo(durationSec: number, sampleRate: number = SAMPLE_RATE): StereoBuffer {
    const len = Math.max(1, Math.ceil(durationSec * sampleRate));
    return [new Float32Array(len), new Float32Array(len)];
}

export function monoPcm(data: MonoBuffer): RenderedPcm {
    return { channels: [data], sampleRate: SAMPLE_RATE };
}

export function stereoPcm(data: StereoBuffer): RenderedPcm {
    return { channels: [data[0], data[1]], sampleRate: SAMPLE_RATE };
}

export function toAudioBuffer(ctx: AudioContext, pcm: RenderedPcm): AudioBuffer {
    const [first] = pcm.channels;
    if (first === undefined) {
        throw new Error('A factory sample needs at least one channel.');
    }
    const buf = ctx.createBuffer(pcm.channels.length, first.length, pcm.sampleRate);
    pcm.channels.forEach((channel, index) => {
        buf.getChannelData(index).set(channel);
    });
    return buf;
}
