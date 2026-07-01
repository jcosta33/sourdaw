import { isTauri as isTauriRuntimeAvailable } from '#/utils/tauriRuntime';

export function isNativeProjectRuntimeAvailable(): boolean {
    return isTauriRuntimeAvailable();
}
