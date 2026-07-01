import { isNativeProjectRuntimeAvailable as readNativeProjectRuntimeAvailable } from '../repositories/runtime/isNativeProjectRuntimeAvailable';

export function isNativeProjectRuntimeAvailable(): boolean {
    return readNativeProjectRuntimeAvailable();
}
