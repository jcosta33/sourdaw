import { type DeviceNodeEntry } from '../buildDeviceChain';
import { resolveToasterPadBinding } from '../resolveToasterPadBinding';

import { type OfflineTrackStrip } from './types';

type OfflineToasterTrack = Parameters<typeof resolveToasterPadBinding>[0][number];

type ConnectOfflineToasterPadRoutesInput = {
    tracks: readonly OfflineToasterTrack[];
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>;
    deviceEntriesByTrack: ReadonlyMap<string, readonly DeviceNodeEntry[]>;
};

export function connectOfflineToasterPadRoutes({
    tracks,
    trackStripsById,
    deviceEntriesByTrack,
}: ConnectOfflineToasterPadRoutesInput): void {
    for (const track of tracks) {
        const binding = resolveToasterPadBinding(tracks, track.id);
        if (!binding) {
            continue;
        }
        const destination = trackStripsById.get(track.id)?.inputNode;
        const toaster = deviceEntriesByTrack
            .get(binding.toasterParentTrackId)
            ?.find((entry) => entry.deviceType === 'toaster');
        if (!destination || !toaster?.strategy.connectPadOutput || !toaster.strategy.setPadDryRouted) {
            continue;
        }
        toaster.strategy.connectPadOutput(binding.padIndex, destination);
        toaster.strategy.setPadDryRouted(binding.padIndex, true);
    }
}
