import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { Marker, ArrangementSection } from "../models/Marker";

const logger = Container.getInstance().get(Logger);

export type MarkerStoreState = {
    markers: Marker[];
    sections: ArrangementSection[];
};

export const markerStore = new Store<MarkerStoreState>(logger, {
    initialData: { markers: [], sections: [] },
});
