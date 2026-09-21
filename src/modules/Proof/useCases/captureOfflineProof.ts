import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

type ProofDeviceInput = { parameterValues: Record<string, number> };

type CaptureOfflineProofInput = {
    deviceId: string;
    /** A supplied device (including null) never falls back to the live project. */
    device?: ProofDeviceInput | null;
};

/** Detach persisted module-order parameters before any offline setup can yield. */
export function captureOfflineProof({ deviceId, device }: CaptureOfflineProofInput) {
    let source = device;
    if (source === undefined) {
        const tracks = getTrackStoreState()?.tracks ?? [];
        for (const track of tracks) {
            source = track.devices.find(
                (candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.proof
            );
            if (source) {
                break;
            }
        }
    }
    return source ? structuredClone({ parameterValues: source.parameterValues }) : null;
}
