import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { TimeSignatureChange } from "../models/TimeSignatureMap";

const logger = Container.getInstance().get(Logger);

export type TimeSignatureMapStoreState = {
    changes: TimeSignatureChange[];
};

export const timeSignatureMapStore = new Store<TimeSignatureMapStoreState>(logger, {
    initialData: { changes: [] },
});
