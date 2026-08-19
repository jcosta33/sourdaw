import { isDesktopRuntime } from '#/utils/desktopBridge';

export function isCrumbsNativeAvailable(): boolean {
    return isDesktopRuntime();
}
