import { audioEngine } from '../repositories/createWebAudioEngine';
import { registerBuiltinPlugins, initWAMEnvironment, registerBuiltinFaustDSP } from '#/modules/Plugin/useCases';
import { requestMicPermission } from './audioRecorder/requestMicPermission';

export const initializeAudioEngineDependencies = {
    audioEngine,
    requestMicPermission,
    registerBuiltinPlugins,
    registerBuiltinFaustDSP,
    initWAMEnvironment,
} as const;

export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();

    // Request mic permission early so the prompt appears on first user
    // interaction instead of at the first record attempt.
    requestMicPermission();

    // Register WAM 2.0 builtin plugins and Faust DSP modules
    registerBuiltinPlugins();
    registerBuiltinFaustDSP();

    // Initialize WAM environment
    const ctx = audioEngine.context;
    if (ctx) {
        initWAMEnvironment(ctx);
    }
}
