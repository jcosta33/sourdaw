import { describe, it, expect, vi } from 'vitest';

import { initializeAudioEngine } from '../initializeAudioEngine';

const { mocks } = vi.hoisted(() => {
    return {
        mocks: {
            initialize: vi.fn().mockResolvedValue(undefined),
            registerPlugins: vi.fn(),
            registerFaustDsp: vi.fn(),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        initialize: mocks.initialize,
        context: null as AudioContext | null,
    },
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        registerBuiltinPlugins: mocks.registerPlugins,
        registerBuiltinFaustDSP: mocks.registerFaustDsp,
        initWAMEnvironment: vi.fn(),
    };
});

describe('initializeAudioEngine', () => {
    it('initializes the engine and registers builtin DSP hosts', async () => {
        await initializeAudioEngine();

        expect(mocks.initialize).toHaveBeenCalledTimes(1);
        expect(mocks.registerPlugins).toHaveBeenCalledTimes(1);
        expect(mocks.registerFaustDsp).toHaveBeenCalledTimes(1);
    });
});
