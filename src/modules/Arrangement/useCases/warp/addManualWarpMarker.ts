import { createWarpMarker } from '../../models/WarpMarker';
import { getWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

type AddManualWarpMarkerInput = {
    clipId: string;
    beat: number;
};

export function addManualWarpMarker({ clipId, beat }: AddManualWarpMarkerInput): Promise<void> {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(beat, beat, { origin: 'user' });
    return commitClipWarpState(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((alpha, beta) => alpha.originalBeat - beta.originalBeat),
    });
}
