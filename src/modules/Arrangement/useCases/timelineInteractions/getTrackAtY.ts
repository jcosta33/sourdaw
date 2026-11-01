import { getRenderedTrackExtent } from '../../models/TimelineTrackExtent';

export function getTrackAtY(
    tracks: { height: number; id: string; variationLanes?: readonly unknown[] }[],
    contentY: number
): { index: number; id: string } | null {
    let offset = 0;
    for (let index = 0; index < tracks.length; index++) {
        const extent = getRenderedTrackExtent(tracks[index]!);
        if (contentY >= offset && contentY < offset + extent) {
            return { index, id: tracks[index]!.id };
        }
        offset += extent;
    }
    return null;
}
