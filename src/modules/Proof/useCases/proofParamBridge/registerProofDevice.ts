import { startProofLoudnessSampler } from '../../stores/proofLoudnessHistory';

import { bridges } from './helpers';

import type { ProofAudioBridge } from './helpers';

type RegisterProofDeviceInput = { deviceId: string; bridge: ProofAudioBridge };

export function registerProofDevice({ deviceId, bridge }: RegisterProofDeviceInput): void {
    bridges.set(deviceId, bridge);
    // The loudness graph is read as a continuous window, so the clock belongs to
    // the device rather than to the component that draws it: a desk-level switch
    // or a closed panel must not splice its own downtime out of the time axis.
    // `unregisterProofDevice` is what stops it.
    startProofLoudnessSampler(deviceId);
}
