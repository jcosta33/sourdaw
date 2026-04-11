import { isTauriAvailable } from './helpers';

/** Check whether the native CRDT backend is available. */
export const isNativeCrdtAvailable = (): boolean => {
    return isTauriAvailable();
};