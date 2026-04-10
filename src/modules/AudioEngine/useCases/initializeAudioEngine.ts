import { inject } from '#/infra/di/inject';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { registerBuiltinPlugins } from '#/modules/Plugin/useCases/wamPluginHost/builtinDescriptors';
import { initWAMEnvironment } from '#/modules/Plugin/useCases/wamPluginHost/hostOperations';
import { registerBuiltinFaustDSP } from '#/modules/Plugin/useCases/faustEngine/builtinDSP';
import { requestMicPermission } from './audioRecorder/requestMicPermission';

export const initializeAudioEngineDependencies = {
    audioEngine,
    getTransportStoreValue,
    requestMicPermission,
    registerBuiltinPlugins,
    registerBuiltinFaustDSP,
    initWAMEnvironment,
} as const;

export const initializeAudioEngine = inject(initializeAudioEngineDependencies)(
    ({
        audioEngine: engine,
        getTransportStoreValue: getTransport,
        requestMicPermission: requestMic,
        registerBuiltinPlugins: registerPlugins,
        registerBuiltinFaustDSP: registerFaustDsp,
        initWAMEnvironment: initWam,
    }) =>
        async function initializeAudioEngine(): Promise<void> {
            await engine.initialize();

            // Request mic permission early so the prompt appears on first user
            // interaction instead of at the first record attempt.
            requestMic();

            const transport = getTransport();
            if (transport) {
                engine.setMasterGain(transport.masterGain / 100);
            }

            // Register WAM 2.0 builtin plugins and Faust DSP modules
            registerPlugins();
            registerFaustDsp();

            // Initialize WAM environment
            const ctx = engine.context;
            if (ctx) {
                initWam(ctx);
            }
        }
);
