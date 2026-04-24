import { describe, it, expect } from 'vitest';

import { samplesToAudioBuffer } from '../samplesToAudioBuffer';
import { type DecodedAudio } from '../tauriDecoding/decodeAudioFile';

/** Node test env often has no Web Audio — provide a minimal BaseAudioContext-like stub. */
function createTestAudioContext(): BaseAudioContext {
    return {
        createBuffer(channels: number, length: number, sampleRate: number) {
            const channelBuffers: Float32Array[] = [];
            for (let context = 0; context < channels; context++) {
                channelBuffers.push(new Float32Array(length));
            }
            return {
                sampleRate,
                length,
                numberOfChannels: channels,
                duration: length / sampleRate,
                getChannelData(ch: number) {
                    return channelBuffers[ch]!;
                },
                copyFromChannel: () => {},
                copyToChannel: () => {},
            } as AudioBuffer;
        },
    } as unknown as BaseAudioContext;
}

describe('samplesToAudioBuffer', () => {
    it('should de-interleave stereo samples into channel buffers', () => {
        const ctx = createTestAudioContext();
        const decoded: DecodedAudio = {
            samples: [1, 0.5, -1, -0.5],
            sampleRate: 44_100,
            channels: 2,
            durationMs: 0,
            totalFrames: 2,
        };

        const buffer = samplesToAudioBuffer(decoded, ctx);

        expect(buffer.numberOfChannels).toBe(2);
        expect(buffer.length).toBe(2);
        expect(buffer.getChannelData(0)).toEqual(new Float32Array([1, -1]));
        expect(buffer.getChannelData(1)).toEqual(new Float32Array([0.5, -0.5]));
    });

    it('should treat missing sample values as zero', () => {
        const ctx = createTestAudioContext();
        const decoded: DecodedAudio = {
            samples: [],
            sampleRate: 44_100,
            channels: 1,
            durationMs: 0,
            totalFrames: 1,
        };

        const buffer = samplesToAudioBuffer(decoded, ctx);

        expect(buffer.getChannelData(0)[0]).toBe(0);
    });
});
