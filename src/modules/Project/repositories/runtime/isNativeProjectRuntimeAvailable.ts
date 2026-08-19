import { isDesktopRuntime as isDesktopRuntimeAvailable } from '#/utils/desktopRuntime';

export function isNativeProjectRuntimeAvailable(): boolean {
    return isDesktopRuntimeAvailable();
}
