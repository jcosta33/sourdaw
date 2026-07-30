import { captureLatencyCompensationSnapshot } from './captureLatencyCompensationSnapshot';

export function getMaxTrackLatency(): number {
    return captureLatencyCompensationSnapshot().getMaxTrackLatency();
}
