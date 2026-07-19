import { yeastStore } from '../stores/yeastStore';

export function hydrateYeastCrdtProjection(): void {
    yeastStore.hydrate();
}
