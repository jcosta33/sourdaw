import { isTauriAvailable } from './helpers';

/** Check whether the native CRDT backend is available. */
export function isNativeCrdtAvailable(): boolean {
    return isTauriAvailable();
}
