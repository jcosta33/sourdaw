import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { ConsoleWriter } from "#/helpers/Logger/Writer/ConsoleWriter";
import { EventBus } from "#/helpers/Event/EventBus";

const logger = new Logger([new ConsoleWriter()]);
Container.getInstance().register(Logger, logger);

export const eventBus = new EventBus(logger);
export { logger };
