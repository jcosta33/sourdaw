import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { type BranchStoreState, MAIN_BRANCH_ID } from '../models/BranchTypes';

export const branchStore = createStore<BranchStoreState>({
    storage: createLocalStorage('sourdaw-branches'),
    initialData: {
        branches: [
            {
                branchId: MAIN_BRANCH_ID,
                name: 'Main',
                rootDocId: 'root',
                sourceBranchId: null,
                createdAt: Date.now(),
                createdFromHeads: [],
                note: '',
            },
        ],
        activeBranchId: MAIN_BRANCH_ID,
    },
});
