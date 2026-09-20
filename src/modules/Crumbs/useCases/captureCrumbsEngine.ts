import { crumbsStore, type CrumbsState } from '../stores/crumbsStore';

import { hydrateCrumbsStateFromDevice } from './hydrateCrumbsStateFromDevice';
import { hydrateCrumbsStateFromProject } from './hydrateCrumbsStateFromProject';

type CaptureCrumbsEngineInput = {
    deviceId: string;
    device?: Parameters<typeof hydrateCrumbsStateFromDevice>[0] | null;
    /** Omit to capture session state; null explicitly selects only the supplied device. */
    state?: CrumbsState | null;
};

/** Capture playback mode and file identity before sample decoding or graph setup yields. */
export function captureCrumbsEngine({ deviceId, device, state }: CaptureCrumbsEngineInput) {
    let source = state === undefined ? crumbsStore.value?.[deviceId] : state;
    if (!source) {
        if (device !== undefined) {
            source = device === null ? null : hydrateCrumbsStateFromDevice(device);
        } else if (state === undefined) {
            source = hydrateCrumbsStateFromProject(deviceId);
        }
    }
    if (!source) {
        return null;
    }
    return structuredClone({ mode: source.mode, filePath: source.activeSample?.filePath ?? null });
}
