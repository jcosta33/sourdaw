import { addTrack as addTrackImpl } from '#/modules/Arrangement/useCases';

export function addTrack(opts: Parameters<typeof addTrackImpl>[0]) {
    addTrackImpl(opts);
}
