import { isNativeAiRuntimeAvailable as readNativeAiRuntimeAvailability } from '../../../repositories/nativeEngine/isNativeAiRuntimeAvailable';

export function isNativeAiRuntimeAvailable(): boolean {
    return readNativeAiRuntimeAvailability();
}
