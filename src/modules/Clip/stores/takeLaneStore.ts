import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type TakeLane } from '#/modules/Clip/models/TakeLane';

const logger = Container.getInstance().get(Logger);

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const takeLaneStore = new Store<TakeLaneStoreState>(logger, {
    initialData: { lanes: [] },
});
