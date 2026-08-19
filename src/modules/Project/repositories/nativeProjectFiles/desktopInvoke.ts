import { desktopInvoke as bridgeInvoke } from '#/utils/desktopBridge';

import { isNativeAvailable } from './helpers';

export async function desktopInvoke<TResult>(cmd: string, args?: Record<string, unknown>): Promise<TResult> {
    if (!isNativeAvailable()) {
        throw new Error('Sourdaw desktop bridge is not available');
    }
    const result = await bridgeInvoke(cmd, args);
    return result as TResult;
}
