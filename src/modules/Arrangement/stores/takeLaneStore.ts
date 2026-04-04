import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type TakeLane } from '#/modules/Arrangement/models/TakeLane';

const logger = Container.getInstance().get(Logger);

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const takeLaneStore = new Store<TakeLaneStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'takeLanes'),
    initialData: { lanes: [] },
});
