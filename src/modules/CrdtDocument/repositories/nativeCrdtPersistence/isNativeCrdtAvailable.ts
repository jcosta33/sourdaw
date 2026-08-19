import { isDesktopRuntime } from '#/utils/desktopRuntime';

/** Check whether the native CRDT backend is available. */
export function isNativeCrdtAvailable(): boolean {
    return isDesktopRuntime();
}
