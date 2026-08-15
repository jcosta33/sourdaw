import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateNativeToolCalls } from '../nativeToolCalling';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
    tauriInvoke: mocks.tauriInvoke,
}));

function getInvocationArgs(callIndex: number): Record<string, unknown> {
    const call: unknown = mocks.tauriInvoke.mock.calls[callIndex];
    if (!Array.isArray(call)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    const args: unknown = call[1];
    if (!isRecord(args)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function generateToolCalls() {
    return generateNativeToolCalls({
        systemPrompt: 'system',
        userMessage: 'mute drums',
        tools: [],
        temperature: 0.1,
    });
}

describe('generateNativeToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null without invoking native tool calling outside Tauri', async () => {
        mocks.isTauri.mockReturnValue(false);

        const result = await generateNativeToolCalls({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
        });

        expect(result).toBeNull();
        expect(mocks.tauriInvoke).not.toHaveBeenCalled();
    });

    it('should invoke native_tool_calling and narrow valid tool-call payloads', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue({
            status: 'complete',
            protocolVersion: 1,
            requestId: 'request-1',
            metadata: { provider: 'qwen' },
            toolCalls: [
                {
                    id: 'call-1',
                    name: 'mute_track',
                    arguments: { track_id: 'track-1', muted: true },
                    metadata: { provider: 'qwen' },
                },
            ],
        });

        const result = await generateNativeToolCalls({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
        });

        expect(mocks.tauriInvoke.mock.calls[0]?.[0]).toBe('native_tool_calling');
        const invocationArgs = getInvocationArgs(0);
        expect(invocationArgs).toEqual({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
            requestId: invocationArgs.requestId,
        });
        expect(typeof invocationArgs.requestId).toBe('string');
        expect(result).toEqual([{ id: 'call-1', name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]);
    });

    it('should reject malformed native_tool_calling payloads before use cases consume them', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue({
            status: 'complete',
            protocolVersion: 1,
            toolCalls: [{ name: 'mute_track', arguments: null }],
        });

        await expect(
            generateNativeToolCalls({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
                temperature: 0.1,
            })
        ).rejects.toMatchObject({
            name: 'NativeToolCallingProtocolError',
            message: 'Invalid native_tool_calling response: item 0 has invalid arguments',
        });
    });

    it('should surface a native protocol rejection without treating it as invoke failure', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue({
            status: 'rejected',
            protocolVersion: 1,
            reason: 'Native tool calling returned inconsistent finish reason length',
            requestId: 'request-1',
            metadata: { provider: 'qwen' },
        });

        await expect(
            generateNativeToolCalls({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
                temperature: 0.1,
            })
        ).rejects.toMatchObject({
            name: 'ToolPlanningRejectedError',
            message: 'Native tool calling returned inconsistent finish reason length',
        });
    });

    it.each([
        null,
        [],
        { status: 'complete', protocolVersion: 1 },
        { status: 'rejected', protocolVersion: 1, reason: null },
        { status: 'unknown', protocolVersion: 1, toolCalls: [] },
        { status: 'complete', toolCalls: [] },
        { status: 'complete', protocolVersion: 2, toolCalls: [] },
    ])('should report malformed native protocol envelope %# as an operational failure', async (response) => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue(response);

        await expect(
            generateNativeToolCalls({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                tools: [],
                temperature: 0.1,
            })
        ).rejects.toMatchObject({
            name: 'NativeToolCallingProtocolError',
            message: 'Invalid native_tool_calling response envelope',
        });
    });

    it.each([
        {
            label: 'complete envelope with a reason',
            response: { status: 'complete', protocolVersion: 1, toolCalls: [], reason: 'contradictory' },
        },
        {
            label: 'rejected envelope with tool calls',
            response: { status: 'rejected', protocolVersion: 1, reason: 'Rejected', toolCalls: [] },
        },
    ])('should reject a $label', async ({ response }) => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue(response);

        await expect(generateToolCalls()).rejects.toMatchObject({
            name: 'NativeToolCallingProtocolError',
            message: 'Invalid native_tool_calling response envelope',
        });
    });

    it('should reject parameters beside a tool-call item arguments record', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue({
            status: 'complete',
            protocolVersion: 1,
            toolCalls: [
                {
                    name: 'mute_track',
                    arguments: { nested: { provider: true } },
                    parameters: { type: 'object' },
                },
            ],
        });

        await expect(generateToolCalls()).rejects.toMatchObject({
            name: 'NativeToolCallingProtocolError',
            message: 'Invalid native_tool_calling response: item 0 has contradictory fields',
        });
    });

    it('should preserve native invoke failures for orchestration fallback', async () => {
        mocks.isTauri.mockReturnValue(true);
        const invokeError = new Error('Native model unavailable');
        mocks.tauriInvoke.mockRejectedValue(invokeError);

        await expect(
            generateNativeToolCalls({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                tools: [],
                temperature: 0.1,
            })
        ).rejects.toBe(invokeError);
    });

    it('should cancel native tool planning when the signal aborts', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockImplementation((command: string) => {
            if (command === 'native_tool_calling') {
                return new Promise<never>(() => undefined);
            }
            return Promise.resolve(undefined);
        });
        const controller = new AbortController();
        const pending = generateNativeToolCalls({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
            signal: controller.signal,
        });

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.tauriInvoke.mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
        expect(getInvocationArgs(1).requestId).toBe(getInvocationArgs(0).requestId);
    });
});
