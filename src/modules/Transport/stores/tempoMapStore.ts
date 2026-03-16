import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { TempoChange } from "../models/TempoMap";

const logger = Container.getInstance().get(Logger);

export type TempoMapStoreState = {
    changes: TempoChange[];
};

export const tempoMapStore = new Store<TempoMapStoreState>(logger, {
    initialData: { changes: [] },
});
