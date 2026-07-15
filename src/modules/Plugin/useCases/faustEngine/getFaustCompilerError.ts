import { faustEngineState } from './faustEngineState';

export function getFaustCompilerError(): string | null {
    return faustEngineState.compiler.error;
}
