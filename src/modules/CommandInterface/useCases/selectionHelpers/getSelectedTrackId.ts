import { trackStore } from '#/modules/Arrangement/stores';

export function getSelectedTrackId(): string | null {
    return trackStore.value?.selectedTrackId ?? null;
}
