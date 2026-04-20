import { type Track } from '#/modules/Arrangement/models/Track';

import { hasToasterDevice } from './hasToasterDevice';

export function shouldCreateOfflineStrip(track: Track): boolean {
    return track.kind !== 'folder' || hasToasterDevice(track);
}
