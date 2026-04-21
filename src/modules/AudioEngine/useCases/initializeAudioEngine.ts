import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { registerBuiltinPlugins, initWAMEnvironment, registerBuiltinFaustDSP } from '#/modules/Plugin/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

export async function initializeAudioEngine(): Promise<void> {
    await audioEngine.initialize();
    syncKneadToEngine();
    registerBuiltinFaustDSP();
    const ctx = audioEngine.context;
    if (ctx) {
        void initWAMEnvironment(ctx);
    }
}
