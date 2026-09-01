export type LlmActionStrategyDefinition<Name extends string, Input, Result> = {
    name: Name;
    transform: (input: Input) => Result;
};

export function createLlmActionStrategyRegistry<Name extends string, Input, Result>(
    definitions: readonly LlmActionStrategyDefinition<Name, Input, Result>[],
    expectedNames: readonly Name[]
): ReadonlyMap<Name, (input: Input) => Result> {
    const registry = new Map<Name, (input: Input) => Result>();
    for (const definition of definitions) {
        if (registry.has(definition.name)) {
            throw new Error(`Duplicate LLM action strategy: ${definition.name}`);
        }
        registry.set(definition.name, definition.transform);
    }
    for (const expectedName of expectedNames) {
        if (!registry.has(expectedName)) {
            throw new Error(`Missing LLM action strategy: ${expectedName}`);
        }
    }
    return registry;
}
