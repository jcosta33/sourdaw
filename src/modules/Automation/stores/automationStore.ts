import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type AutomationLane } from '../models/Automation';

export type { AutomationLane };

const DOC_PREFIX_ROOT = 'root';

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const automationStore = createStore<AutomationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'automation'),
    initialData: { lanes: [] },
});
