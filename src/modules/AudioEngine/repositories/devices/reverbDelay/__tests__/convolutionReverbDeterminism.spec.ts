import { describe, expect, it, vi } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyConvolutionReverbParams, IR_NAMES } from '../applyConvolutionReverbParams';
import { createConvolutionReverb } from '../createConvolutionReverb';
import { generateIR, IR_GENERATORS } from '../helpers';

vi.stubGlobal('AudioBuffer', MockAudioBuffer);

describe('convolution reverb determinism (#3737)', () => {
    it('generateIR produces identical sample data for identical configurations', () => {
        const config = {
            sampleRate: 48000,
            duration: 0.8,
            decayT60: 0.5,
            earlyMs: 10,
            earlyLevel: 2.2,
            diffusion: 0.5,
            hfDamping: 7000,
            lfDamping: 100,
        };
        const ir1 = generateIR(config);
        const ir2 = generateIR(config);

        expect(Array.from(ir1.getChannelData(0))).toEqual(Array.from(ir2.getChannelData(0)));
        expect(Array.from(ir1.getChannelData(1))).toEqual(Array.from(ir2.getChannelData(1)));
    });

    it('IR_GENERATORS presets produce deterministic impulse responses across repeated calls', () => {
        for (const [, generator] of Object.entries(IR_GENERATORS)) {
            const buf1 = generator(48000);
            const buf2 = generator(48000);
            expect(Array.from(buf1.getChannelData(0))).toEqual(Array.from(buf2.getChannelData(0)));
            expect(Array.from(buf1.getChannelData(1))).toEqual(Array.from(buf2.getChannelData(1)));
        }
    });

    it('createConvolutionReverb produces identical default impulse buffers on repeated creation', () => {
        const ctx1 = createMockAudioContext();
        const ctx2 = createMockAudioContext();
        const dev1 = createConvolutionReverb(asBaseAudioContext(ctx1));
        const dev2 = createConvolutionReverb(asBaseAudioContext(ctx2));

        const conv1 = dev1.nodes[3] as ConvolverNode;
        const conv2 = dev2.nodes[3] as ConvolverNode;

        expect(Array.from(conv1.buffer!.getChannelData(0))).toEqual(Array.from(conv2.buffer!.getChannelData(0)));
        expect(Array.from(conv1.buffer!.getChannelData(1))).toEqual(Array.from(conv2.buffer!.getChannelData(1)));
    });

    it('applyConvolutionReverbParams produces identical impulse buffers upon same-IR reapplication', () => {
        const ctx = createMockAudioContext();
        const dev = createConvolutionReverb(asBaseAudioContext(ctx));
        const conv = dev.nodes[3] as ConvolverNode;

        const studioAIndex = IR_NAMES.indexOf('studio-a');
        applyConvolutionReverbParams(dev, { 'conv-ir': studioAIndex });
        const buf1 = conv.buffer!;
        const ch0First = Array.from(buf1.getChannelData(0));
        const ch1First = Array.from(buf1.getChannelData(1));

        applyConvolutionReverbParams(dev, { 'conv-ir': studioAIndex });
        const buf2 = conv.buffer!;
        const ch0Second = Array.from(buf2.getChannelData(0));
        const ch1Second = Array.from(buf2.getChannelData(1));

        expect(ch0Second).toEqual(ch0First);
        expect(ch1Second).toEqual(ch1First);
    });

    it('supports custom seeds and produces distinct output for different seeds', () => {
        const baseConfig = {
            sampleRate: 48000,
            duration: 0.2,
            decayT60: 0.2,
            earlyMs: 10,
            earlyLevel: 2,
            diffusion: 0.5,
            hfDamping: 6000,
            lfDamping: 100,
        };
        const irA1 = generateIR({ ...baseConfig, seed: 42 });
        const irA2 = generateIR({ ...baseConfig, seed: 42 });
        const irB = generateIR({ ...baseConfig, seed: 99 });

        expect(Array.from(irA1.getChannelData(0))).toEqual(Array.from(irA2.getChannelData(0)));
        expect(Array.from(irA1.getChannelData(0))).not.toEqual(Array.from(irB.getChannelData(0)));
    });
});
