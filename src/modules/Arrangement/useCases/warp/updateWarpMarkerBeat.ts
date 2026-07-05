import { getWarpState, warpStates } from '../../stores/warpStates';

type UpdateWarpMarkerBeatInput = {
    clipId: string;
    markerId: string;
    field: 'originalBeat' | 'warpedBeat';
    beat: number;
};

export function updateWarpMarkerBeat(input: UpdateWarpMarkerBeatInput): void {
    const current = getWarpState(input.clipId);
    warpStates.set(input.clipId, {
        ...current,
        markers: current.markers.map((marker) =>
            marker.id === input.markerId ? { ...marker, [input.field]: input.beat } : marker
        ),
    });
}
