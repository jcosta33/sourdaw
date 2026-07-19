import { commandMutationRuntime } from './commandMutationRuntime';

export function isCommandMutationExecutingSynchronously(): boolean {
    return commandMutationRuntime.synchronousOwner !== null;
}
