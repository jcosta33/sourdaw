import { isDesktopRuntime } from '#/utils/desktopBridge';

export function isNativeVoiceInputAvailable(): boolean {
    return isDesktopRuntime();
}
