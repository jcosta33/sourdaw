import { faustEngineState } from './faustEngineState';

export function isFaustCompilerReady(): boolean {
    return faustEngineState.compiler.ready;
}
