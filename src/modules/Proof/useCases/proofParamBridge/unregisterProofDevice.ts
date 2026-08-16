import { clearProofLoudnessHistory } from '../../stores/proofLoudnessHistory';

import { bridges } from './helpers';

export function unregisterProofDevice(deviceId: string): void {
    bridges.delete(deviceId);
    // The loudness history outlives the panel on purpose (a desk-level switch
    // unmounts the graph), so the device going away is what bounds it.
    clearProofLoudnessHistory(deviceId);
}
