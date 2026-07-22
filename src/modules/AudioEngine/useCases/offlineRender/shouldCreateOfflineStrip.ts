import { shouldCreateLiveTrackStrip, type getTrackEligibility } from '#/modules/Arrangement/stores';

type ShouldCreateOfflineStripInput = {
    kind: Parameters<typeof getTrackEligibility>[0];
    devices: readonly { type: string }[];
};

export function shouldCreateOfflineStrip(track: ShouldCreateOfflineStripInput): boolean {
    return shouldCreateLiveTrackStrip(track);
}
