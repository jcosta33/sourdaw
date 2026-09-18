import { describe, expect, it } from 'vitest';

import { cloneAgentWorkOwnerIdentity, getAudioBufferContentAddress } from '../agentRenderReceipt';

function createBuffer(input: { sampleRate?: number; channels: readonly (readonly number[])[] }): AudioBuffer {
    const sampleRate = input.sampleRate ?? 48_000;
    const channels = input.channels.map((samples) => Float32Array.from(samples));
    const frameCount = channels[0]?.length ?? 0;
    return {
        sampleRate,
        length: frameCount,
        numberOfChannels: channels.length,
        duration: frameCount / sampleRate,
        getChannelData: (channel: number) => channels[channel],
    } as AudioBuffer;
}

describe('getAudioBufferContentAddress', () => {
    it('gives two separately built buffers holding the same audio one address', async () => {
        const first = createBuffer({
            channels: [
                [0.25, -0.5],
                [0.75, 1],
            ],
        });
        const second = createBuffer({
            channels: [
                [0.25, -0.5],
                [0.75, 1],
            ],
        });

        expect(await getAudioBufferContentAddress(first)).toBe(await getAudioBufferContentAddress(second));
    });

    it('separates buffers that differ only in sample rate', async () => {
        const base = createBuffer({ sampleRate: 44_100, channels: [[0.25, -0.5]] });
        const resampled = createBuffer({ sampleRate: 48_000, channels: [[0.25, -0.5]] });

        expect(await getAudioBufferContentAddress(base)).not.toBe(await getAudioBufferContentAddress(resampled));
    });

    it('separates buffers that differ only in frame count', async () => {
        const shorter = createBuffer({ channels: [[0.25, -0.5]] });
        const longer = createBuffer({ channels: [[0.25, -0.5, 0]] });

        expect(await getAudioBufferContentAddress(shorter)).not.toBe(await getAudioBufferContentAddress(longer));
    });

    it('separates a mono buffer from a stereo buffer carrying the same first channel', async () => {
        const mono = createBuffer({ channels: [[0.25, -0.5]] });
        const stereo = createBuffer({
            channels: [
                [0.25, -0.5],
                [0, 0],
            ],
        });

        expect(await getAudioBufferContentAddress(mono)).not.toBe(await getAudioBufferContentAddress(stereo));
    });

    it('separates buffers that differ only in one sample of a later channel', async () => {
        const base = createBuffer({
            channels: [
                [0.25, -0.5],
                [0.75, 1],
            ],
        });
        const altered = createBuffer({
            channels: [
                [0.25, -0.5],
                [0.75, 0.5],
            ],
        });

        expect(await getAudioBufferContentAddress(base)).not.toBe(await getAudioBufferContentAddress(altered));
    });

    it('separates buffers that differ only in one sample of the first channel', async () => {
        const base = createBuffer({ channels: [[0.25, -0.5]] });
        const altered = createBuffer({ channels: [[0.25, -0.25]] });

        expect(await getAudioBufferContentAddress(base)).not.toBe(await getAudioBufferContentAddress(altered));
    });
});

describe('cloneAgentWorkOwnerIdentity', () => {
    it('returns a fresh object that no longer follows the caller identity it copied', () => {
        const owner = { runId: 'run-1', workId: 'work-1', leaseId: 'lease-1', cancellationGeneration: 3 };

        const clone = cloneAgentWorkOwnerIdentity(owner);

        expect(clone).toEqual(owner);
        expect(clone).not.toBe(owner);
        owner.cancellationGeneration = 9;
        expect(clone?.cancellationGeneration).toBe(3);
    });

    it('returns null for an absent identity', () => {
        expect(cloneAgentWorkOwnerIdentity(null)).toBeNull();
    });
});
