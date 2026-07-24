import { describe, expect, it, vi } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyConvolutionReverbParams, IR_NAMES } from '../applyConvolutionReverbParams';
import { createConvolutionReverb } from '../createConvolutionReverb';
import { IR_GENERATORS } from '../helpers';

// generateIR() in helpers.ts uses the `new AudioBuffer(...)` constructor form; jsdom omits it.
vi.stubGlobal('AudioBuffer', MockAudioBuffer);

function param(node: unknown, property: string): { value: number } {
    const candidate = node ? Reflect.get(node, property) : null;
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`Expected AudioParam at .${property}`);
    }
    return candidate as { value: number };
}

describe('applyConvolutionReverbParams', () => {
    it('applies mix, predelay (ms→s), lowcut and highcut', () => {
        const ctx = createMockAudioContext();
        const device = createConvolutionReverb(asBaseAudioContext(ctx));
        applyConvolutionReverbParams(device, {
            'conv-mix': 0.45,
            'conv-predelay': 30,
            'conv-lowcut': 90,
            'conv-highcut': 9000,
        });
        expect(param(device.nodes[2], 'gain').value).toBe(0.45);
        expect(param(device.nodes[1], 'gain').value).toBe(1 - 0.45);
        expect(param(device.nodes[5], 'delayTime').value).toBe(30 / 1000);
        expect(param(device.nodes[6], 'frequency').value).toBe(90);
        expect(param(device.nodes[7], 'frequency').value).toBe(9000);
    });

    it('selects an IR by valid index and writes the generated buffer', () => {
        const ctx = createMockAudioContext();
        const device = createConvolutionReverb(asBaseAudioContext(ctx));
        const convolver = device.nodes[3] as unknown as ConvolverNode;
        const lastIndex = IR_NAMES.length - 1;
        const expectedName = IR_NAMES[lastIndex]!;
        const spy = vi.spyOn(IR_GENERATORS, expectedName);

        applyConvolutionReverbParams(device, { 'conv-ir': lastIndex });

        expect(spy).toHaveBeenCalledWith(ctx.sampleRate);
        expect(convolver.buffer).not.toBeNull();
    });

    it('falls back to studio-a IR when the index is out of range', () => {
        const ctx = createMockAudioContext();
        const device = createConvolutionReverb(asBaseAudioContext(ctx));
        const convolver = device.nodes[3] as unknown as ConvolverNode;
        const spy = vi.spyOn(IR_GENERATORS, 'studio-a');

        applyConvolutionReverbParams(device, { 'conv-ir': 9999 });

        expect(spy).toHaveBeenCalledWith(ctx.sampleRate);
        expect(convolver.buffer).not.toBeNull();
    });

    it('skips writing the IR buffer when the convolver has no context', () => {
        const ctx = createMockAudioContext();
        const device = createConvolutionReverb(asBaseAudioContext(ctx));
        const convolver = device.nodes[3] as unknown as ConvolverNode & { context: BaseAudioContext | null };
        const before = convolver.buffer;
        (convolver as { context: BaseAudioContext | null }).context = null; // break the guard
        applyConvolutionReverbParams(device, { 'conv-ir': 0 });
        expect(convolver.buffer).toBe(before); // unchanged
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createConvolutionReverb(asBaseAudioContext(ctx));
        const beforeWet = param(device.nodes[2], 'gain').value;
        applyConvolutionReverbParams(device, {});
        expect(param(device.nodes[2], 'gain').value).toBe(beforeWet);
    });
});
