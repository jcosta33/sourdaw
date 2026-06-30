import { isNativeEngineReady as readNativeEngineReady } from '../../repositories/nativeEngine/lifecycle';

export function isNativeEngineReady(): boolean {
    return readNativeEngineReady();
}
