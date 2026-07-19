import { type CommandMutationOwner } from './commandMutationOwner';

export const commandMutationRuntime: {
    activeOwner: CommandMutationOwner | null;
    synchronousOwner: CommandMutationOwner | null;
} = {
    activeOwner: null,
    synchronousOwner: null,
};
