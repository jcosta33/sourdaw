import { trackStore } from '../stores/trackStore';

export function setTrackStoreState(state: NonNullable<typeof trackStore.value>): void {
    trackStore.set(state);
}
