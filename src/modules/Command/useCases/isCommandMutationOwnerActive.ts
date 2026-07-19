import { type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';

export function isCommandMutationOwnerActive(owner: CommandMutationOwner): boolean {
    return owner.active && commandMutationRuntime.activeOwner?.rootToken === owner.rootToken;
}
