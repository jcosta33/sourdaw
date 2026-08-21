/* SPDX-FileCopyrightText: 2026 Jose Costa */
/* SPDX-License-Identifier: Apache-2.0 */

/** Schema for a single LLM-callable tool (Hermes function calling format). */
export type ToolSchema = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, unknown>;
            required: string[];
            additionalProperties?: boolean;
        };
    };
};

/** Convenience builder — avoids repeating the nested structure every time. */
export function tool(
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = []
): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties, required },
        },
    };
}
