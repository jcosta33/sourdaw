import { isTauri } from '#/utils/tauriRuntime';

export async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        return null;
    }

    const { tauriInvoke } = await import('#/utils/tauriBridge');
    return tauriInvoke(command, args);
}
