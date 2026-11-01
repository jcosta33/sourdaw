import { type ToolSchema } from '../models/ToolDefinitions';

export function projectReadonlyAnswerMeasurementToolSchema(schema: ToolSchema): ToolSchema {
    const { scope, range, metrics } = schema.function.parameters.properties;
    return {
        ...schema,
        function: {
            ...schema.function,
            description:
                'Measure the current project scope and range without preparing or previewing changes. Returns figures and evidence, never audio.',
            parameters: {
                type: 'object',
                properties: { scope, range, metrics },
                required: ['scope', 'range'],
                additionalProperties: false,
            },
        },
    };
}
