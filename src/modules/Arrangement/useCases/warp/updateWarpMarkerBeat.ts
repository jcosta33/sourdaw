import { warpStates } from '../../stores/warpStates';

type UpdateWarpMarkerBeatInput = {
    clipId: string;
    markerId: string;
    field: 'originalBeat' | 'warpedBeat';
    beat: number;
};

export function updateWarpMarkerBeat(input: UpdateWarpMarkerBeatInput): void {
    const current = warpStates.get(input.clipId);
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
    const nextState = {
        ...current,
        markers: nextMarkers,
    };
    warpStates.set(input.clipId, nextState);
}
