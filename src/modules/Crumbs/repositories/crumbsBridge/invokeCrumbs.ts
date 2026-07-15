import { tauriInvoke } from '#/utils/tauriBridge';

export function invokeCrumbs(command: string, args: Record<string, unknown>): Promise<unknown> {
    return tauriInvoke(command, args);
}
