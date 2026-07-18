import { duplicateTrack as duplicateTrackImpl } from '#/modules/Arrangement/useCases';

export function duplicateTrack(trackId: string) {
    return duplicateTrackImpl(trackId);
}
