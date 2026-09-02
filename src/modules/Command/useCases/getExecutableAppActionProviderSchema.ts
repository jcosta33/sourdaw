import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

export type ExecutableAppActionProviderSchema = {
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
};

export function getExecutableAppActionProviderSchema(actionType: 'addNotes'): ExecutableAppActionProviderSchema {
    const providerSchema = getExecutableCommandRegistration(actionType).providerSchema;
    return {
        properties: structuredClone(providerSchema.properties),
        required: [...providerSchema.required],
    };
}
