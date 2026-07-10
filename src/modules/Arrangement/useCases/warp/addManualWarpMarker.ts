import { addWarpMarker } from '../../stores/warpStates';

type AddManualWarpMarkerInput = {
    clipId: string;
    beat: number;
};

export function addManualWarpMarker({ clipId, beat }: AddManualWarpMarkerInput): void {
    addWarpMarker(clipId, beat, beat, { origin: 'user' });
}
