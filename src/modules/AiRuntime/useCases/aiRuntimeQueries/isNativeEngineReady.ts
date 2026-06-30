import { isNativeEngineReady as readNativeEngineReady } from '../../repositories/nativeEngine/isNativeEngineReady';

export function isNativeEngineReady(): boolean {
    return readNativeEngineReady();
}
