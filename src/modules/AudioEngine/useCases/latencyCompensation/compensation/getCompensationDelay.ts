import { captureLatencyCompensationSnapshot } from './captureLatencyCompensationSnapshot';

export function getCompensationDelay(trackId: string): number {
    return captureLatencyCompensationSnapshot().getCompensationDelay(trackId);
}
