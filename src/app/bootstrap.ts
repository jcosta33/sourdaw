// registerDependencies MUST be the first import — it populates the DI Container
// before any downstream module (like toasterSubscriber → toasterStore) resolves
// Logger/EventBus at module scope.
import { eventBus, logger } from './registerDependencies';
import { initToasterSubscribers } from '#/modules/Toaster/useCases';
import { initBrowserAi } from '#/modules/BrowserAi';

initToasterSubscribers();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((err: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(err)}`);
});

export { eventBus, logger };
