import { inject } from '#/infra/di/inject';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { registerBuiltinPlugins, initWAMEnvironment, registerBuiltinFaustDSP } from '#/modules/Plugin';
import { requestMicPermission } from './audioRecorder/requestMicPermission';

export const initializeAudioEngineDependencies = {
    audioEngine,
    requestMicPermission,
    registerBuiltinPlugins,
    registerBuiltinFaustDSP,
    initWAMEnvironment,
} as const;

export const initializeAudioEngine = inject(initializeAudioEngineDependencies)(
    ({
        audioEngine: engine,
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
