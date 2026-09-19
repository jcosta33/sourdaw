import { type ToolSchema } from '../../../models/ToolDefinitions';

import { type HostedToolChoiceDirective } from './hostedToolPlan';

/**
 * The tool schemas one hosted turn may advertise for its directive. `auto` sends every schema
 * unchanged; `required` narrows to the named subset, preserving the advertised order, so the
 * wire `tools` list matches the tool set the model is being forced to choose from. An empty
 * narrowed set paired with a forced tool choice is a request no provider can ever satisfy, so
 * that case throws before any network call rather than sending it.
 */
export function narrowToolSchemasForDirective(
    toolSchemas: readonly ToolSchema[],
    directive: HostedToolChoiceDirective
): readonly ToolSchema[] {
    if (directive.mode === 'auto') {
        return toolSchemas;
    }
    const narrowed = toolSchemas.filter((schema) => directive.toolNames.includes(schema.function.name));
    if (narrowed.length === 0) {
        throw new Error(
            `Hosted AI tool-choice directive named an empty tool set: ${JSON.stringify(directive.toolNames)}`
        );
    }
    return narrowed;
}
