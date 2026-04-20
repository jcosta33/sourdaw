import { inject } from '#/infra/di/inject';

import { createLevainBridge } from './helpers';
import { levainBridgeDependencies } from './levainBridgeDependencies';

import type { LevainBridgeApi } from './helpers';

/**
 * Injectable singleton — resolves **`getAllTracks`**, **`persistDeviceParam`**, **`autoLoadLevainSamples`** for tests via **`injectDependencies(levainBridge, …)`**.
 */
export const levainBridge = inject(levainBridgeDependencies)((deps) => {
    const bridge = createLevainBridge(deps);
    return function getLevainBridgeSingleton(): LevainBridgeApi {
        return bridge;
    };
});
