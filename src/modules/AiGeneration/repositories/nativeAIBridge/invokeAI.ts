import { isDesktopRuntime } from '#/utils/desktopRuntime';

export async function invokeAI(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isDesktopRuntime()) {
        throw new Error('Native AI features require the Sourdaw desktop app');
    }

    const { desktopInvoke } = await import('#/utils/desktopBridge');
    return desktopInvoke(cmd, args);
}
