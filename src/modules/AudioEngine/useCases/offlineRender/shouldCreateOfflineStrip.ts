import { getTrackEligibility } from '#/modules/Arrangement/stores';

import { hasToasterDevice } from './hasToasterDevice';

type ShouldCreateOfflineStripInput = {
    kind: string;
    devices: readonly { type: string }[];
};

export function shouldCreateOfflineStrip(track: ShouldCreateOfflineStripInput): boolean {
    const eligibility = getTrackEligibility(track.kind);
    if (eligibility.createsOfflineStrip) {
        return true;
    }
    if (track.kind === 'folder') {
        return hasToasterDevice(track);
    }
    return false;
}
