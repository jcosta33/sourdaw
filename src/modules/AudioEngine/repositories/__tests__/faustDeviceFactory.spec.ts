import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createFaustDevice } from '../faustDeviceFactory';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        logger: { warn: vi.fn() },
        compileFaustDSP: vi.fn().mockResolvedValue(false),
        createFaustNode: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('#/modules/Plugin/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: vi.fn(),
}));

describe('createFaustDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compileFaustDSP.mockReset();
        mocks.createFaustNode.mockReset();
    });

    it('should return null and warn when compilation fails', async () => {
        mocks.compileFaustDSP.mockResolvedValue(false);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-test');

        expect(result).toBeNull();
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to compile'));
        expect(mocks.createFaustNode).not.toHaveBeenCalled();
    });

    it('should return offline nodes when compilation and node creation succeed', async () => {
        mocks.compileFaustDSP.mockResolvedValue(true);
        const fakeNode = { numberOfInputs: 1, numberOfOutputs: 1 } as unknown as AudioWorkletNode;
        mocks.createFaustNode.mockResolvedValue(fakeNode);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-ok');

        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(fakeNode);
        expect(result?.outputNode).toBe(fakeNode);
    });
});
