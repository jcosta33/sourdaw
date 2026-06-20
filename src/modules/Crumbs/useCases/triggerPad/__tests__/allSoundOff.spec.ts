import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    crumbsAllSoundOff: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/crumbsBridge', () => ({
    crumbsAllSoundOff: mocks.crumbsAllSoundOff,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

import { allSoundOff } from '../allSoundOff';

describe('allSoundOff', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates the panic to the bridge for the given instance', async () => {
        await allSoundOff('inst1');
        expect(mocks.crumbsAllSoundOff).toHaveBeenCalledWith('inst1');
    });

    it('swallows a bridge error and logs a warning instead of throwing', async () => {
        mocks.crumbsAllSoundOff.mockRejectedValueOnce(new Error('engine offline'));
        await expect(allSoundOff('inst1')).resolves.toBeUndefined();
        expect(mocks.warn).toHaveBeenCalledWith('All sound off failed:', expect.any(Error));
    });
});
