import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyLimiterParams } from '../applyLimiterParams';
import { createLimiter } from '../createLimiter';

function param(node: unknown, property: string): { value: number } {
    const candidate = node ? Reflect.get(node, property) : null;
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`Expected AudioParam at .${property}`);
    }
    return candidate as { value: number };
}

describe('applyLimiterParams', () => {
    it('applies threshold, release (ms→s) and ceiling (dB→gain)', () => {
        const ctx = createMockAudioContext();
        const device = createLimiter(asBaseAudioContext(ctx));
        applyLimiterParams(device, { 'lim-threshold': -3, 'lim-release': 250, 'lim-ceiling': -1 });
        expect(param(device.nodes[0], 'threshold').value).toBe(-3);
        expect(param(device.nodes[0], 'release').value).toBe(250 / 1000);
        expect(param(device.nodes[1], 'gain').value).toBeCloseTo(10 ** (-1 / 20));
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createLimiter(asBaseAudioContext(ctx));
        const before = param(device.nodes[0], 'threshold').value;
        applyLimiterParams(device, {});
        expect(param(device.nodes[0], 'threshold').value).toBe(before);
    });
});
