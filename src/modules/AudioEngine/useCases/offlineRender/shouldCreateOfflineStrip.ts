import { hasToasterDevice } from './hasToasterDevice';

type ShouldCreateOfflineStripInput = {
    kind: string;
    devices: readonly { type: string }[];
};

export function shouldCreateOfflineStrip(track: ShouldCreateOfflineStripInput): boolean {
    return track.kind !== 'folder' || hasToasterDevice(track);
}
