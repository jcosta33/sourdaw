import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { initializeAudioEngine } from './initializeAudioEngine';

describe('initializeAudioEngine', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('initializes the engine and registers builtin DSP hosts', async () => {
        const initialize = vi.fn().mockResolvedValue(undefined);
        const registerPlugins = vi.fn();
        const registerFaustDsp = vi.fn();
        const requestMic = vi.fn();
        const engineStub = {
            initialize,
            context: null as AudioContext | null,
        };
        injectDependencies(initializeAudioEngine, {
            audioEngine: engineStub as typeof engineStub & { context: AudioContext | null },
            requestMicPermission: requestMic,
            registerBuiltinPlugins: registerPlugins,
            registerBuiltinFaustDSP: registerFaustDsp,
            initWAMEnvironment: vi.fn(),
        });

        await initializeAudioEngine();

        expect(initialize).toHaveBeenCalledTimes(1);
        expect(requestMic).toHaveBeenCalledTimes(1);
        expect(registerPlugins).toHaveBeenCalledTimes(1);
        expect(registerFaustDsp).toHaveBeenCalledTimes(1);
    });
});
