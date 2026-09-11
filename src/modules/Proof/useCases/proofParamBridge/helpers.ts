import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

/**
 * The Proof worklet's own message surface, for the two gestures that have no
 * device-parameter spelling.
 *
 * A live parameter write is deliberately not here: it travels through
 * {@link sendProofParam} so the native body carrying this device hears it too.
 */
export type ProofAudioBridge = {
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
};

export const bridges = new Map<string, ProofAudioBridge>();

/**
 * Send one live Proof parameter through the door every device write reaches the
 * DSP through.
 *
 * `updateDeviceParam` writes the Web Audio node and, while the native session
 * carries this device, sends the same value natively — so a panel gesture is
 * heard by whichever carrier is sounding the strip. Writing the worklet bridge
 * directly instead would reach the web twin alone and leave a natively carried
 * Proof on the value it was mapped with.
 */
export function sendProofParam(deviceId: string, name: string, value: number): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    updateDeviceParam(target.trackId, deviceId, name, value);
}
