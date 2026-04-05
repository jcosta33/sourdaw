import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { ConsoleWriter } from '#/helpers/Logger/Writer/ConsoleWriter';
import { EventBus } from '#/helpers/Event/EventBus';

// This file must be imported before any module that resolves Logger or EventBus
// at module scope. ES module imports are evaluated depth-first in source order,
// so importing './registerDependencies' before any other import in bootstrap.ts
// guarantees the container is populated before downstream modules load.

const logger = new Logger([new ConsoleWriter()]);
Container.getInstance().register(Logger, logger);

export const eventBus = new EventBus(logger);
Container.getInstance().register(EventBus, eventBus);

export { logger };
