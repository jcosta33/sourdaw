/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */
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
