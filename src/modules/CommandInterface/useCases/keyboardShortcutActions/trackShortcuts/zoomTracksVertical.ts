import { zoomTracksVertical as zoomTracksVerticalImpl } from '#/modules/Arrangement/useCases';

export function zoomTracksVertical(delta: number) {
    return zoomTracksVerticalImpl(delta);
}
