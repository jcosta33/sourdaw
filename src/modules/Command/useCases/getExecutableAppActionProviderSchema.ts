import { type ExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

export type ExecutableAppActionProviderSchema = {
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
};

export function getExecutableAppActionProviderSchema<ActionType extends ExecutableAppActionType>(
    actionType: ActionType
): ExecutableAppActionProviderSchema {
    const providerSchema = getExecutableCommandRegistration(actionType).providerSchema;
    return {
        properties: structuredClone(providerSchema.properties),
        required: [...providerSchema.required],
    };
}
