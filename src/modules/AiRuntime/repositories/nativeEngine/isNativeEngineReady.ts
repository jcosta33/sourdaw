import { nativeEngineState } from './lifecycleState';

export function isNativeEngineReady(): boolean {
    return nativeEngineState.ready;
}
