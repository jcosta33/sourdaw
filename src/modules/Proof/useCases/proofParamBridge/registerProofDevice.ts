import { bridges } from './helpers';

import type { ProofAudioBridge } from './helpers';

export function registerProofDevice(deviceId: string, b: ProofAudioBridge): void {
    bridges.set(deviceId, b);
}
