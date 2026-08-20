import { isDesktopRuntime as isDesktopRuntimeAvailable } from '#/utils/desktopRuntime';

export function isNativeSampleLibraryRuntimeAvailable(): boolean {
    return isDesktopRuntimeAvailable();
}
