import { describe, expect, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { DAW_TOOL_SCHEMAS } from '../ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../WorkflowCapability';

describe('WorkflowCapability', () => {
    it('resolves every workflow action tool name to a provider or executable tool schema', () => {
        const resolvableToolNames = new Set(
            [...DAW_TOOL_SCHEMAS, ...getExecutableAppActionToolSchemas()].map((tool) => tool.function.name)
        );

        const unresolvableToolNames = [...WORKFLOW_ACTION_TOOL_NAMES].filter(
            (toolName) => !resolvableToolNames.has(toolName)
        );

        expect(unresolvableToolNames).toEqual([]);
    });
});
