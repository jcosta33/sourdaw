import { bridges } from './helpers';

import type { ProofAudioBridge } from './helpers';

type RegisterProofDeviceInput = { deviceId: string; bridge: ProofAudioBridge };

export function registerProofDevice({ deviceId, bridge }: RegisterProofDeviceInput): void {
    bridges.set(deviceId, bridge);
}
