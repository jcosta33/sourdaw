import { isDesktopRuntime } from '#/utils/desktopRuntime';

export function isNativeAvailable(): boolean {
    return isDesktopRuntime();
}
