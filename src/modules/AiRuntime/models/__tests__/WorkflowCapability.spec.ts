import { describe, expect, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { WORKFLOW_ACTION_TOOL_NAMES } from '../WorkflowCapability';

describe('WorkflowCapability', () => {
    it('resolves every workflow action tool name to a visible executable Command schema', () => {
        const resolvableToolNames = new Set<string>(
            getExecutableAppActionToolSchemas().map((tool) => tool.function.name)
        );

        const unresolvableToolNames = [...WORKFLOW_ACTION_TOOL_NAMES].filter(
            (toolName) => !resolvableToolNames.has(toolName)
        );

        expect(unresolvableToolNames).toEqual([]);
    });
});
