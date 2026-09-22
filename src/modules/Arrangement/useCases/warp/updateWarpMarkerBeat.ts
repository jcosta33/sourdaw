import { getStoredWarpState, setWarpState } from '../../stores/warpStates';

type UpdateWarpMarkerBeatInput = {
    clipId: string;
    markerId: string;
    field: 'originalBeat' | 'warpedBeat';
    beat: number;
};

export function updateWarpMarkerBeat(input: UpdateWarpMarkerBeatInput): void {
    const current = getStoredWarpState(input.clipId);
    if (!current) {
        return;
    }
    const target = current.markers.find((marker) => marker.id === input.markerId);
    if (!target || target[input.field] === input.beat) {
        return;
    }

    const nextMarkers = current.markers.map((marker) =>
        marker.id === input.markerId ? { ...marker, [input.field]: input.beat } : marker
    );
    setWarpState(input.clipId, {
        ...current,
        markers: nextMarkers,
    });
}
