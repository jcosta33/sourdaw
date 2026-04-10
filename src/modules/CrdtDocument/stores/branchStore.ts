import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

export type BranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

export type BranchStoreState = {
    branches: BranchRecord[];
    activeBranchId: string;
};

export const MAIN_BRANCH_ID = 'main';

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
