import { isTauri } from '#/utils/tauriBridge';

import { NativeToolCallingProtocolError } from '../../errors/NativeToolCallingProtocolError';
import { ToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';
import { NATIVE_TOOL_CALLING_PROTOCOL_SCHEMA_VERSION } from '../../models/LlmOrchestrationTypes';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';

type NativeToolDefinition = {
    name: string;
    description: string;
    parameters: unknown;
};

type NativeToolCallResult = {
    id?: string;
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

    return narrowNativeToolCallingResponse(response);
}

function narrowNativeToolCallingResponse(response: unknown): NativeToolCallResult[] {
    if (!isRecord(response) || response.protocolVersion !== NATIVE_TOOL_CALLING_PROTOCOL_SCHEMA_VERSION) {
        throw new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope');
    }
    if (response.status === 'rejected') {
        if (
            Object.hasOwn(response, 'toolCalls') ||
            typeof response.reason !== 'string' ||
            response.reason.trim().length === 0
        ) {
            throw new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope');
        }
        throw new ToolPlanningRejectedError(response.reason);
    }
    if (response.status !== 'complete' || Object.hasOwn(response, 'reason') || !Array.isArray(response.toolCalls)) {
        throw new NativeToolCallingProtocolError('Invalid native_tool_calling response envelope');
    }
    return narrowNativeToolCallResults(response.toolCalls);
}

function narrowNativeToolCallResults(response: unknown): NativeToolCallResult[] {
    if (!Array.isArray(response)) {
        throw new NativeToolCallingProtocolError('Invalid native_tool_calling response: expected an array');
    }

    return response.map((item, index) => {
        if (!isRecord(item)) {
            throw new NativeToolCallingProtocolError(
                `Invalid native_tool_calling response: item ${String(index)} is not an object`
            );
        }
        if (Object.hasOwn(item, 'parameters')) {
            throw new NativeToolCallingProtocolError(
                `Invalid native_tool_calling response: item ${String(index)} has contradictory fields`
            );
        }

        const name = item.name;
        const args = item.arguments;
        const id = item.id;

        if (typeof name !== 'string' || name.length === 0) {
            throw new NativeToolCallingProtocolError(
                `Invalid native_tool_calling response: item ${String(index)} has no name`
            );
        }
        if (!isRecord(args)) {
            throw new NativeToolCallingProtocolError(
                `Invalid native_tool_calling response: item ${String(index)} has invalid arguments`
            );
        }

        if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
            throw new NativeToolCallingProtocolError(
                `Invalid native_tool_calling response: item ${String(index)} has invalid id`
            );
        }

        return { ...(typeof id === 'string' ? { id } : {}), name, arguments: args };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
