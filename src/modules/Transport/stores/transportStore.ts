import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import { defaultTransportState, type TransportState } from "../models/TransportState";

const logger = Container.getInstance().get(Logger);

export const transportStore = new Store<TransportState>(logger, {
    initialData: defaultTransportState,
});
