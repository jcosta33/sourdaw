export type GroundingAdmissionResult = string | null;

export type GroundingAdmissionStrategy<Input, Result = GroundingAdmissionResult> = (input: Input) => Result;

export type GroundingAdmissionStrategyDefinition<Name extends string, Input, Result = GroundingAdmissionResult> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: GroundingAdmissionStrategy<Input, Result>;
    };
}[Name];

function toSentenceCase(label: string): string {
    return `${label.slice(0, 1).toLocaleUpperCase()}${label.slice(1)}`;
}

export function createGroundingAdmissionStrategyRegistry<Name extends string, Input, Result = GroundingAdmissionResult>(
    label: string,
    definitions: readonly GroundingAdmissionStrategyDefinition<Name, Input, Result>[],
    catalog: readonly { actionType: string }[],
    expectedActionNames: readonly Name[]
): ReadonlyMap<Name, GroundingAdmissionStrategy<Input, Result>> {
    const registry = new Map<Name, GroundingAdmissionStrategy<Input, Result>>();
    const catalogActionNames = new Set(catalog.map((entry) => entry.actionType));
    for (const definition of definitions) {
        if (registry.has(definition.name)) {
            throw new Error(`Duplicate ${label} strategy: ${definition.name}`);
        }
        if (!catalogActionNames.has(definition.name)) {
            throw new Error(
                `${toSentenceCase(label)} strategy is not a canonical executable action: ${definition.name}`
            );
        }
        registry.set(definition.name, definition.transform);
    }
    for (const actionName of expectedActionNames) {
        if (!registry.has(actionName)) {
            throw new Error(`Missing ${label} strategy: ${actionName}`);
        }
    }
    return registry;
}
