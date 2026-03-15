import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { AutomationLane } from "../models/Automation";

const logger = Container.getInstance().get(Logger);

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const automationStore = new Store<AutomationStoreState>(logger, {
    initialData: { lanes: [] },
});
