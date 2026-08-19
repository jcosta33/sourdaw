import { isDesktopRuntime } from '#/utils/desktopRuntime';

export async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isDesktopRuntime()) {
        return null;
    }

    const { desktopInvoke } = await import('#/utils/desktopBridge');
    return desktopInvoke(command, args);
}
