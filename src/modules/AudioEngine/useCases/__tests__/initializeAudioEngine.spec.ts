import { beforeEach, describe, it, expect, vi } from 'vitest';

import { initializeAudioEngine } from '../initializeAudioEngine';

const { mocks } = vi.hoisted(() => {
    return {
        mocks: {
            initialize: vi.fn().mockResolvedValue(undefined),
            registerFaustDsp: vi.fn(),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        initialize: mocks.initialize,
    },
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        registerBuiltinFaustDSP: mocks.registerFaustDsp,
    };
});

describe('initializeAudioEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.initialize.mockResolvedValue(undefined);
    });

    it('initializes the engine and registers builtin DSP hosts', async () => {
        await initializeAudioEngine();

        expect(mocks.initialize).toHaveBeenCalledTimes(1);
        expect(mocks.registerFaustDsp).toHaveBeenCalledTimes(1);
    });

    it('does not register DSP hosts when engine initialization rejects', async () => {
        mocks.initialize.mockRejectedValueOnce(new Error('Audio engine has been disposed'));

        await expect(initializeAudioEngine()).rejects.toThrow('Audio engine has been disposed');

        expect(mocks.registerFaustDsp).not.toHaveBeenCalled();
    });
});
