import { getTrackStoreState } from '#/modules/Arrangement/useCases';

export function getSelectedTrackId(): string | null {
    return getTrackStoreState()?.selectedTrackId ?? null;
}