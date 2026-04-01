import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';

import { type BranchStoreState, MAIN_BRANCH_ID } from '../models/BranchTypes';

const logger = Container.getInstance().get(Logger);

export const branchStore = new Store<BranchStoreState>(logger, {
    storage: new LocalStorageStorage('sourdaw-branches'),
    initialData: {
        branches: [{
            branchId: MAIN_BRANCH_ID,
            name: 'Main',
            rootDocId: 'root',
            sourceBranchId: null,
            createdAt: Date.now(),
            createdFromHeads: [],
            note: '',
        }],
        activeBranchId: MAIN_BRANCH_ID,
    },
});
