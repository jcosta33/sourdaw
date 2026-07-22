import { type OfflineBusStrip, type OfflineTrackStrip } from './types';

export function createOfflineBusStrip(trackStrip: OfflineTrackStrip): OfflineBusStrip {
    return { gainNode: trackStrip.inputNode };
}
