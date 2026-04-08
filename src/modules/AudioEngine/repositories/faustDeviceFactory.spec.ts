import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createFaustDevice } from './faustDeviceFactory';
import { type Logger } from '#/helpers/Logger/Logger';

describe('createFaustDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null and warn when compilation fails', async () => {
        const compileFaustDSP = vi.fn().mockResolvedValue(false);
        const createFaustNode = vi.fn();
        const logger = createMock<Logger>();
        injectDependencies(createFaustDevice, { logger, compileFaustDSP, createFaustNode });

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-test');

        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to compile'));
        expect(createFaustNode).not.toHaveBeenCalled();
    });

    it('should return offline nodes when compilation and node creation succeed', async () => {
        const compileFaustDSP = vi.fn().mockResolvedValue(true);
        const fakeNode = { numberOfInputs: 1, numberOfOutputs: 1 } as unknown as AudioWorkletNode;
        const createFaustNode = vi.fn().mockResolvedValue(fakeNode);
        const logger = createMock<Logger>();
        injectDependencies(createFaustDevice, { logger, compileFaustDSP, createFaustNode });

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-ok');

        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(fakeNode);
        expect(result?.outputNode).toBe(fakeNode);
    });
});
