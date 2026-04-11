import type { ProofAudioBridge } from './helpers';
import { bridges } from './helpers';

export function registerProofDevice(deviceId: string, b: ProofAudioBridge): void {
    bridges.set(deviceId, b);
}