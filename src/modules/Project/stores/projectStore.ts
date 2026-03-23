import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type ProjectStoreState = {
    name: string;
    createdAt: number;
    updatedAt: number;
    dirty: boolean;
    loading: boolean;
};

export const projectStore = new Store<ProjectStoreState>(logger, {
    initialData: {
        name: 'Untitled Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: true,
    },
});

