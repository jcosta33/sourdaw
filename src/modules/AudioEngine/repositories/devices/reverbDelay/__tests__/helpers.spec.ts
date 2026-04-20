import { describe, it, expect, vi } from 'vitest';

import { MockAudioBuffer } from '../../../../../../helpers/__tests__/audioContext.mock';
import { generateIR, IR_GENERATORS } from '../helpers';

vi.stubGlobal('AudioBuffer', MockAudioBuffer);

describe('reverbDelay/helpers', () => {
    it('generateIR should produce a stereo buffer with length matching duration', () => {
        const sampleRate = 48_000;
        const duration = 0.1;
        const buf = generateIR({
            sampleRate,
            duration,
            decayT60: 0.4,
            earlyMs: 15,
            earlyLevel: 2,
            diffusion: 0.6,
            hfDamping: 6000,
            lfDamping: 80,
        });
        expect(buf.numberOfChannels).toBe(2);
        expect(buf.length).toBe(Math.ceil(sampleRate * duration));
        expect(buf.sampleRate).toBe(sampleRate);
    });

    it('IR_GENERATORS presets should return non-empty stereo buffers', () => {
        const sampleRate = 44_100;
        for (const key of Object.keys(IR_GENERATORS)) {
            const generator = IR_GENERATORS[key];
            if (!generator) {
                throw new Error(`missing generator: ${key}`);
            }
            const buf = generator(sampleRate);
            expect(buf.numberOfChannels).toBe(2);
            expect(buf.length).toBeGreaterThan(0);
        }
    });
});
