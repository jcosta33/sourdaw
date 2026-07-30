import { executableAppActionDescriptors } from './executableAppActionRegistry';

export function getExecutableAppActionToolSchemas() {
    return executableAppActionDescriptors.map((descriptor) => ({
        type: 'function' as const,
        function: {
            name: descriptor.actionType,
            description: descriptor.description,
            parameters: {
                type: 'object' as const,
                properties: structuredClone(descriptor.parameters.properties),
                required: [...descriptor.parameters.required],
                additionalProperties: false,
            },
        },
    }));
}
