import { audioEngine } from '../repositories/createWebAudioEngine';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { registerBuiltinPlugins, initWAMEnvironment } from '#/modules/Plugin/useCases/wamPluginHost';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine';

export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();

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
