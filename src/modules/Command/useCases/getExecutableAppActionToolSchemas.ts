import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

export function getExecutableAppActionToolSchemas() {
    return getExecutableCommandRegistrations().map((registration) => ({
        type: 'function' as const,
        function: {
            name: registration.actionType,
            description: registration.toolDescription,
            parameters: {
                type: 'object' as const,
                properties: structuredClone(registration.providerSchema.properties),
                required: [...registration.providerSchema.required],
                additionalProperties: false,
            },
        },
    }));
}
