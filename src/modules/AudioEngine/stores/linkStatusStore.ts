import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

export type LinkStatus = {
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
};

export const defaultLinkStatus: LinkStatus = {
    enabled: false,
    tempo: 120,
    quantum: 4,
    beat: 0,
    phase: 0,
    num_peers: 0,
};

export const linkStatusStore = new Store<LinkStatus>(logger, {
    initialData: defaultLinkStatus,
});

export const subscribeToLinkStatus = linkStatusStore.subscribe.bind(linkStatusStore);
export const getLinkStatusSnapshot = () => linkStatusStore.value?.enabled ?? false;
