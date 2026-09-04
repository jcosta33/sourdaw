import { getMidiTransformDescriptors } from '../stores/midiTransformRegistry';

/**
 * Registered transforms in the shape catalog discovery already returns for a command, so a planner
 * that discovered `addNotes` reads a transform's exact schema the same way and needs no second
 * protocol for it.
 */
export function getMidiTransformToolSchemas() {
    return getMidiTransformDescriptors().map((descriptor) => ({
        type: 'function' as const,
        function: {
            name: descriptor.name,
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
