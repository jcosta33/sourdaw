import { isTauri } from '#/utils/tauriBridge';

import { ToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';

type NativeToolDefinition = {
    name: string;
    description: string;
    parameters: unknown;
};

type NativeToolCallResult = {
    name: string;
    arguments: Record<string, unknown>;
};

type GenerateNativeToolCallsInput = {
    systemPrompt: string;
    userMessage: string;
    tools: NativeToolDefinition[];
    temperature: number;
    signal?: AbortSignal;
};

type GenerateNativeToolCallsOutput = Promise<NativeToolCallResult[] | null>;

export async function generateNativeToolCalls(input: GenerateNativeToolCallsInput): GenerateNativeToolCallsOutput {
    if (!isTauri()) {
        return null;
    }

    const response = await invokeCancelableNativeLlm({
        command: 'native_tool_calling',
        args: {
            systemPrompt: input.systemPrompt,
            userMessage: input.userMessage,
            tools: input.tools,
            temperature: input.temperature,
        },
        signal: input.signal,
        abortMessage: 'Native tool planning aborted',
    });

    return narrowNativeToolCallResults(response);
}

function narrowNativeToolCallResults(response: unknown): NativeToolCallResult[] {
    if (!Array.isArray(response)) {
        throw new ToolPlanningRejectedError('Invalid native_tool_calling response: expected an array');
    }

    return response.map((item, index) => {
        if (!isRecord(item)) {
            throw new ToolPlanningRejectedError(
                `Invalid native_tool_calling response: item ${String(index)} is not an object`
            );
        }

        const name = item.name;
        const args = item.arguments;

        if (typeof name !== 'string' || name.length === 0) {
            throw new ToolPlanningRejectedError(
                `Invalid native_tool_calling response: item ${String(index)} has no name`
            );
        }
        if (!isRecord(args)) {
            throw new ToolPlanningRejectedError(
                `Invalid native_tool_calling response: item ${String(index)} has invalid arguments`
            );
        }

        return { name, arguments: args };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
