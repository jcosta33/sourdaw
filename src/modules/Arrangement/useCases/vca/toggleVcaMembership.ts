import { getTrackById } from '../../repositories/track/getTrackById';

import { assignToVca } from './assignToVca';
import { removeFromVca } from './removeFromVca';

export function toggleVcaMembership(trackId: string, vcaGroupId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    if (track.vcaGroupId === vcaGroupId) {
        removeFromVca(trackId);
    } else {
        assignToVca(trackId, vcaGroupId);
    }
}
