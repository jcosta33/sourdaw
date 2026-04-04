import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type AutomationLane } from '../models/Automation';

const logger = Container.getInstance().get(Logger);

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const automationStore = new Store<AutomationStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'automation'),
    initialData: { lanes: [] },
});
