import { type ProjectContext } from '../../../models/ProjectContext';

export const postTargetScopeActionNames = [
    'removeTrack',
    'removeClip',
    'renameClip',
    'clearSolos',
    'removeFromVca',
    'quantizeNotes',
    'transposeNotes',
    'invertNotes',
    'retrogradeNotes',
    'quantizeNoteLengths',
    'scaleAllVelocities',
    'setAllVelocities',
] as const;

export type PostTargetScopeActionName = (typeof postTargetScopeActionNames)[number];

type PostTargetActionScope = {
    matchedIntentPhrase: string;
    text: string;
};

export type PostTargetScopeAdmissionInput = {
    actionName: string;
    actionScope: PostTargetActionScope;
    bulkMutedEmptyTrackDeletionTargetIds: readonly string[] | null;
    context: ProjectContext;
    groundedArguments: Readonly<Record<string, unknown>>;
    plannedActionNames: readonly string[];
    prompt: string;
};

export type PostTargetScopeAdmissionResult = string | null;

export type PostTargetScopeAdmissionStrategy = (
    input: Omit<PostTargetScopeAdmissionInput, 'actionName'>
) => PostTargetScopeAdmissionResult;

export type PostTargetScopeAdmissionStrategyDefinition<Name extends PostTargetScopeActionName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: PostTargetScopeAdmissionStrategy;
    };
}[Name];

export function createPostTargetScopeAdmissionStrategyRegistry<Name extends PostTargetScopeActionName>(
    definitions: readonly PostTargetScopeAdmissionStrategyDefinition<Name>[],
    catalog: readonly { actionType: string }[],
    expectedActionNames: readonly Name[]
): ReadonlyMap<Name, PostTargetScopeAdmissionStrategy> {
    const registry = new Map<Name, PostTargetScopeAdmissionStrategy>();
    const catalogActionNames = new Set(catalog.map((entry) => entry.actionType));
    for (const definition of definitions) {
        if (registry.has(definition.name)) {
            throw new Error(`Duplicate post-target scope admission strategy: ${definition.name}`);
        }
        if (!catalogActionNames.has(definition.name)) {
            throw new Error(
                `Post-target scope admission strategy is not a canonical executable action: ${definition.name}`
            );
        }
        registry.set(definition.name, definition.transform);
    }
    for (const actionName of expectedActionNames) {
        if (!registry.has(actionName)) {
            throw new Error(`Missing post-target scope admission strategy: ${actionName}`);
        }
    }
    return registry;
}
