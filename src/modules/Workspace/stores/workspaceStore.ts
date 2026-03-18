import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { defaultWorkspaceState, type WorkspaceState } from '../models/WorkspaceState';

const logger = Container.getInstance().get(Logger);

export const workspaceStore = new Store<WorkspaceState>(logger, {
    initialData: defaultWorkspaceState,
});
