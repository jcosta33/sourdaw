import { defaultLevainState, levainStore, type LevainState } from '../stores/levainStore';

import { hydrateLevainStateFromDevice } from './hydrateLevainStateFromDevice';
import { hydrateLevainStateFromProject } from './hydrateLevainStateFromProject';

type CaptureOfflineLevainInput = {
    deviceId: string;
    device?: Parameters<typeof hydrateLevainStateFromDevice>[0] | null;
    /** Omit to capture session state; null explicitly selects only the supplied device/default. */
    state?: LevainState | null;
};

/** Capture the instrument identity and patch before any offline setup can yield. */
export function captureOfflineLevain({ deviceId, device, state }: CaptureOfflineLevainInput) {
    const session = state === undefined ? levainStore.value?.[deviceId] : state;
    let restored: LevainState | null = null;
    if (!session) {
        if (device !== undefined) {
            restored = device === null ? null : hydrateLevainStateFromDevice(device);
        } else if (state === undefined) {
            restored = hydrateLevainStateFromProject(deviceId);
        }
    }
    return structuredClone({ patch: (session ?? restored ?? defaultLevainState).patch });
}
