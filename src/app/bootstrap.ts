// registerDependencies MUST be the first import — it populates the DI Container
// before any downstream module (like toasterSubscriber → toasterStore) resolves
// Logger/EventBus at module scope.
import { eventBus, logger } from './registerDependencies';
import { initToasterSubscribers } from '#/modules/Toaster/useCases';
import { initStalenessDetection } from '#/modules/Arrangement/useCases/freezeBounce/initStalenessDetection';
import { initBrowserAi } from '#/modules/BrowserAi';
import { setFermenterDependencies } from '#/modules/Fermenter/useCases/fermenterDependencies';
import {
    getAllTracks,
    persistDeviceParam,
    persistDevicePatch,
    cleanupUnusedFreezeFiles,
} from '#/modules/Arrangement/useCases';
import { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';
import { logCapabilities } from '#/utils/capabilities';

logCapabilities();

window.addEventListener('beforeunload', () => {
    // Attempt GC on window close
    cleanupUnusedFreezeFiles().catch(() => {});
});

setFermenterDependencies({
    getAllTracks,
    persistDeviceParam,
    persistDevicePatch,
    updateDeviceParam,
    updateDevicePatch,
});

initToasterSubscribers();
initStalenessDetection();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((err: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(err)}`);
});

export { eventBus, logger };
