import { isTauri } from '#/utils/tauriRuntime';

export function isNativeAiRuntimeAvailable(): boolean {
    return isTauri();
}
