import { describe, expect, it } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';

import { audioBufferToMp3 as encode } from '../../repositories/audioEncoders/mp3Encoder';
import { audioBufferToMp3 } from '../audioBufferToMp3';

function fixture(): AudioBuffer {
    const buffer = MockAudioBuffer.create(2, 44100, 44100);
    for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index++) {
            samples[index] = 0.1 * Math.sin((2 * Math.PI * (channel === 0 ? 1000 : 400) * index) / 44100);
        }
    }
    return buffer;
}

describe('audioBufferToMp3 podcast metadata', () => {
    it('keeps real encoder bytes identical without metadata, including all-empty metadata', async () => {
        const buffer = fixture();
        const dither = { mode: 'tpdf', seed: 42 } as const;
        const expected = await encode(buffer, 192, undefined, dither);
        expect(expected.length).toBeGreaterThan(1000);
        expect(expected[0]).toBe(255);
        expect(await audioBufferToMp3(buffer, 192, undefined, dither)).toEqual(expected);
        expect(
            await audioBufferToMp3(buffer, 192, undefined, dither, { title: '', artist: '', description: '' })
        ).toEqual(expected);
    });

    it('prepends bounded tags and preserves the exact real encoded MPEG suffix', async () => {
        const buffer = fixture();
        const dither = { mode: 'tpdf', seed: 42 } as const;
        const expected = await encode(buffer, 192, undefined, dither);
        function progress(fraction: number): void {
            expect(fraction).toBeGreaterThanOrEqual(0);
        }
        const tagged = await audioBufferToMp3(buffer, 192, progress, dither, {
            title: '🌊 épisode',
            artist: 'José',
            description: '音楽\nDescription',
        });
        expect(new TextDecoder().decode(tagged.subarray(0, 3))).toBe('ID3');
        const tagEnd = 10 + Array.from(tagged.subarray(6, 10)).reduce((size, digit) => size * 128 + digit, 0);
        expect(tagged.subarray(tagEnd)).toEqual(expected);
    });

    it('rejects invalid metadata before reading PCM or beginning encoding', async () => {
        const buffer = fixture();
        Object.defineProperty(buffer, 'getChannelData', {
            value: () => {
                throw new Error('PCM was read');
            },
        });
        await expect(
            audioBufferToMp3(buffer, 192, undefined, undefined, {
                title: 'x'.repeat(4097),
                artist: '',
                description: '',
            })
        ).rejects.toThrow('4096 UTF-8 bytes');
    });
});
