import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createFaustDevice } from './faustDeviceFactory';
import { type Logger } from '#/helpers/Logger/Logger';
import * as compilerEngine from '#/modules/Plugin/useCases/faustEngine/compilerEngine';

vi.mock('#/modules/Plugin/useCases/faustEngine/compilerEngine', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: vi.fn(),
}));

describe('createFaustDevice', () => {
    beforeEach(() => {
        vi.mocked(compilerEngine.compileFaustDSP).mockReset();
        vi.mocked(compilerEngine.createFaustNode).mockReset();
    });

    it('should return null and warn when compilation fails', async () => {
        vi.mocked(compilerEngine.compileFaustDSP).mockResolvedValue(false);

        const logger = createMock<Logger>();
        injectDependencies(createFaustDevice, { logger });

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-test');

        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to compile'));
    });

    it('should return offline nodes when compilation and node creation succeed', async () => {
        vi.mocked(compilerEngine.compileFaustDSP).mockResolvedValue(true);
        const fakeNode = { numberOfInputs: 1, numberOfOutputs: 1 } as unknown as AudioWorkletNode;
        vi.mocked(compilerEngine.createFaustNode).mockResolvedValue(fakeNode);

        const logger = createMock<Logger>();
        injectDependencies(createFaustDevice, { logger });

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-ok');

        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(fakeNode);
        expect(result?.outputNode).toBe(fakeNode);
    });
});
