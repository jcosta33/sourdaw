import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dawDspEvaluated: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => {
    mocks.dawDspEvaluated();
    throw new Error('daw_dsp.js evaluated');
});

vi.mock('../../../wasm/daw_dsp.js', () => {
    mocks.dawDspEvaluated();
    throw new Error('daw_dsp.js evaluated');
});

describe('pitch WASM load graph', () => {
    it('evaluates analyzePitchForClip without loading daw_dsp.js', async () => {
        await import('../analyzePitchForClip');
        expect(mocks.dawDspEvaluated).not.toHaveBeenCalled();
    });

    it('evaluates processPitchEditWasm without loading daw_dsp.js', async () => {
        await import('../processPitchEditWasm');
        expect(mocks.dawDspEvaluated).not.toHaveBeenCalled();
    });
});
