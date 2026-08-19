import { isDesktopRuntime } from '#/utils/desktopBridge';

export function ensureNative(command: string): void {
    if (!isDesktopRuntime()) {
        throw new Error(`Crumbs IPC "${command}" is only available in the Sourdaw desktop app`);
    }
}
