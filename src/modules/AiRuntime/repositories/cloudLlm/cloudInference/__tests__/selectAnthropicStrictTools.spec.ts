import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../../../models/Tools/Types';
import {
    ANTHROPIC_STRICT_OPTIONAL_PARAMETER_CAP,
    ANTHROPIC_STRICT_TOOL_CAP,
    ANTHROPIC_STRICT_UNION_PARAMETER_CAP,
    selectAnthropicStrictTools,
} from '../selectAnthropicStrictTools';

function tool(name: string, parameters: Record<string, unknown>): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description: `Tool ${name}`,
            parameters: parameters as unknown as ToolSchema['function']['parameters'],
        },
    };
}

/** An object schema with `count` optional string properties and no union types. */
function objectWithOptionalProperties(count: number): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
        properties[`optional${String(index)}`] = { type: 'string' };
    }
    return { type: 'object', properties, required: [], additionalProperties: false };
}

/** An object schema with `count` required properties, each a union of string or number. */
function objectWithUnionProperties(count: number): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (let index = 0; index < count; index += 1) {
        const name = `union${String(index)}`;
        properties[name] = { anyOf: [{ type: 'string' }, { type: 'number' }] };
        required.push(name);
    }
    return { type: 'object', properties, required, additionalProperties: false };
}

const emptyObjectSchema: Record<string, unknown> = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
};

describe('selectAnthropicStrictTools', () => {
    it('sends a tool non-strict when its optional count would exceed the remaining budget, while a later smaller tool is still admitted', () => {
        const nearCapTool = tool('nearCap', objectWithOptionalProperties(20));
        const tooLargeTool = tool('tooLarge', objectWithOptionalProperties(5));
        const stillFitsTool = tool('stillFits', objectWithOptionalProperties(2));

        const admitted = selectAnthropicStrictTools([nearCapTool, tooLargeTool, stillFitsTool]);

        expect(admitted).toEqual([true, false, true]);
    });

    it('sends the 21st zero-optional tool non-strict once the tool-count cap is reached', () => {
        expect(ANTHROPIC_STRICT_TOOL_CAP).toBe(20);
        const tools = Array.from({ length: 21 }, (_, index) => tool(`tool${String(index)}`, emptyObjectSchema));

        const admitted = selectAnthropicStrictTools(tools);

        expect(admitted.slice(0, 20)).toEqual(Array<boolean>(20).fill(true));
        expect(admitted[20]).toBe(false);
    });

    it('binds the union-parameter cap independently of the optional-parameter and tool caps', () => {
        expect(ANTHROPIC_STRICT_UNION_PARAMETER_CAP).toBe(16);
        const fillsUnionCapTool = tool('fillsUnionCap', objectWithUnionProperties(16));
        const overUnionCapTool = tool('overUnionCap', objectWithUnionProperties(1));
        const noUnionTool = tool('noUnion', emptyObjectSchema);

        const admitted = selectAnthropicStrictTools([fillsUnionCapTool, overUnionCapTool, noUnionTool]);

        expect(admitted).toEqual([true, false, true]);
    });

    it('counts an optional property nested inside an array items object and one nested inside an anyOf branch', () => {
        expect(ANTHROPIC_STRICT_OPTIONAL_PARAMETER_CAP).toBe(24);
        const fillsOptionalCapTool = tool('fillsOptionalCap', objectWithOptionalProperties(24));
        const itemsNestedOptionalTool = tool('itemsNestedOptional', {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { extra: { type: 'string' } },
                        required: [],
                        additionalProperties: false,
                    },
                },
            },
            required: ['entries'],
            additionalProperties: false,
        });
        const anyOfNestedOptionalTool = tool('anyOfNestedOptional', {
            type: 'object',
            properties: {
                value: {
                    anyOf: [
                        {
                            type: 'object',
                            properties: { extra: { type: 'string' } },
                            required: [],
                            additionalProperties: false,
                        },
                        { type: 'string' },
                    ],
                },
            },
            required: ['value'],
            additionalProperties: false,
        });

        const admitted = selectAnthropicStrictTools([
            fillsOptionalCapTool,
            itemsNestedOptionalTool,
            anyOfNestedOptionalTool,
        ]);

        // The cap-filling tool alone exhausts the 24-parameter budget, so either nested
        // tool being admitted afterward would prove its one nested optional property
        // went uncounted.
        expect(admitted).toEqual([true, false, false]);
    });

    it('admits every tool when none of the three combined budgets are threatened', () => {
        const admitted = selectAnthropicStrictTools([
            tool('a', objectWithOptionalProperties(1)),
            tool('b', objectWithUnionProperties(1)),
            tool('c', emptyObjectSchema),
        ]);

        expect(admitted).toEqual([true, true, true]);
    });
});
