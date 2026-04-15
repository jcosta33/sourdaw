import { describe, it, expect } from 'vitest';
import { createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { createLufsMeter } from '../createLufsMeter';

describe('createLufsMeter', () => {
    it('should create bypass path, K-weighting filters, and analyser', () => {
        const ctx = createMockAudioContext() as unknown as BaseAudioContext;
        const device = createLufsMeter(ctx);

        expect(ctx.createGain).toHaveBeenCalled();
        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(2);
        expect(ctx.createAnalyser).toHaveBeenCalled();
        expect(device.nodes).toHaveLength(5);
        expect(device.inputNode).toBeDefined();
        expect(device.outputNode).toBeDefined();
    });
});
