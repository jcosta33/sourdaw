import { isTauri as isTauriRuntimeAvailable } from '#/utils/tauriRuntime';

export function isNativeSampleLibraryRuntimeAvailable(): boolean {
    return isTauriRuntimeAvailable();
}
