import { inject } from '#/infra/di/inject';
import { registerBuiltinFaustDSP } from '#/modules/PluginHost/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

/**
 * Initializes the audio engine singleton. Cross-module side effects that
 * follow (e.g. `syncKneadToEngine`) are now wired by the caller
 * (`useAppInitialization`), so this module does not import other modules'
 * use-case barrels that in turn depend on the audio engine.
 */
export const initializeAudioEngine = inject({ audioEngine })(
    ({ audioEngine }) =>
        async function initializeAudioEngine(): Promise<void> {
            await audioEngine.initialize();
            registerBuiltinFaustDSP();
        }
);
