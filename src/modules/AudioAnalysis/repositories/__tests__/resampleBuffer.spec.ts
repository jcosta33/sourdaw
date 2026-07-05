import { describe, expect, it } from 'vitest';

import { resampleBuffer } from '../resampleBuffer';

describe('resampleBuffer', () => {
    it('should return the same buffer when sample rate already matches', async () => {
        const buffer = { sampleRate: 44100, length: 128, numberOfChannels: 1 } as unknown as AudioBuffer;

        const out = await resampleBuffer(buffer, 44100);

        expect(out).toBe(buffer);
    });
});
