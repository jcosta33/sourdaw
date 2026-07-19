export type CommandMutationOwner = {
    readonly rootToken: symbol;
    readonly replay: boolean;
    readonly pending: Set<Promise<unknown>>;
    active: boolean;
};

export function createCommandMutationOwner(parent?: CommandMutationOwner): CommandMutationOwner {
    return {
        rootToken: parent?.rootToken ?? Symbol('Command mutation owner'),
        replay: parent !== undefined,
        pending: new Set(),
        active: true,
    };
}
