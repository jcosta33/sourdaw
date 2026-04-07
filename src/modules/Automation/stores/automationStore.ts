import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type AutomationLane } from '../models/Automation';

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const automationStore = createStore<AutomationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'automation'),
    initialData: { lanes: [] },
});
