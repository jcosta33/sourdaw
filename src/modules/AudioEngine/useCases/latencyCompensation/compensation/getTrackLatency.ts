import { type TrackLatency } from '../../../models/LatencyCompensationTypes';

import { captureLatencyCompensationSnapshot } from './captureLatencyCompensationSnapshot';

export function getTrackLatency(trackId: string): TrackLatency {
    return captureLatencyCompensationSnapshot().getTrackLatency(trackId);
}
