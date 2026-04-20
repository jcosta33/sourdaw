import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { registerBuiltinPlugins, initWAMEnvironment, registerBuiltinFaustDSP } from '#/modules/Plugin/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

export const initializeAudioEngineDependencies = {
    audioEngine,
    registerBuiltinPlugins,
    registerBuiltinFaustDSP,
    initWAMEnvironment,
} as const;

/**
 * Load AudioWorklet modules and register builtin DSP hosts. MUST complete
 * before any UI can create tracks or devices, because TrackNode and device
 * nodes synchronously instantiate AudioWorkletNodes whose processors are
 * registered by this call. Safe to run without a user gesture — resuming the
 * AudioContext is a separate step handled on first interaction.
 */
export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();

    // Start real-time sync for Knead pitch editor
    syncKneadToEngine();

    // Register WAM 2.0 builtin plugins and Faust DSP modules
    registerBuiltinPlugins();
    registerBuiltinFaustDSP();

    // Initialize WAM environment
    const ctx = audioEngine.context;
    if (ctx) {
        initWAMEnvironment(ctx);
    }
}
