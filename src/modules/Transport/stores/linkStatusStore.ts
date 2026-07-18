import { createStore } from '#/infra/store/createStore';

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

export const linkStatusStore = createStore<LinkStatus>({
    initialData: defaultLinkStatus,
});

export const subscribeToLinkStatus = linkStatusStore.subscribe.bind(linkStatusStore);
export function getLinkStatusSnapshot() {
    return linkStatusStore.value?.enabled ?? false;
}
