import { isTauri } from '#/utils/tauriRuntime';

export function isTauriAvailable(): boolean {
    return isTauri();
}
