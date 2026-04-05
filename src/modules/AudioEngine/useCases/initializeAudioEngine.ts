import { audioEngine } from '../repositories/createWebAudioEngine';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { registerBuiltinPlugins } from '#/modules/Plugin/useCases/wamPluginHost/builtinDescriptors';
import { initWAMEnvironment } from '#/modules/Plugin/useCases/wamPluginHost/hostOperations';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine/builtinDSP';
import { requestMicPermission } from './audioRecorder/requestMicPermission';

export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();

    // Request mic permission early so the prompt appears on first user
    // interaction instead of at the first record attempt.
    void requestMicPermission();

    const transport = getTransportStoreValue();
    if (transport) {
        audioEngine.setMasterGain(transport.masterGain / 100);
    }

    // Register WAM 2.0 builtin plugins and Faust DSP modules
    registerBuiltinPlugins();
    registerBuiltinFaustDSP();

    // Initialize WAM environment
    const ctx = audioEngine.context;
    if (ctx) {
        void initWAMEnvironment(ctx);
    }
}
