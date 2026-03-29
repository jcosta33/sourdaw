import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { ConsoleWriter } from '#/helpers/Logger/Writer/ConsoleWriter';
import { EventBus } from '#/helpers/Event/EventBus';
import { initToasterSubscribers } from '#/modules/Toaster/useCases/toasterSubscriber';

const logger = new Logger([new ConsoleWriter()]);
Container.getInstance().register(Logger, logger);

export const eventBus = new EventBus(logger);
Container.getInstance().register(EventBus, eventBus);

initToasterSubscribers();
export { logger };
