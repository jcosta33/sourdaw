// registerDependencies MUST be the first import — it populates the DI Container
// before any downstream module (like toasterSubscriber → toasterStore) resolves
// Logger/EventBus at module scope.
import { eventBus, logger } from './registerDependencies';
import { initToasterSubscribers } from '#/modules/Toaster/useCases/toasterSubscriber';

initToasterSubscribers();

export { eventBus, logger };
