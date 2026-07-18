import { isTauri } from '#/utils/tauriRuntime';

/** Check whether the native CRDT backend is available. */
export function isNativeCrdtAvailable(): boolean {
    return isTauri();
}
