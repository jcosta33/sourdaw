import { bridges } from './helpers';

import type { ProofAudioBridge } from './helpers';

export function registerProofDevice(deviceId: string, bridge: ProofAudioBridge): void {
    bridges.set(deviceId, bridge);
}
