import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateSchemaConstrainedNativeCompletion } from '../schemaConstrainedGeneration';

type TestChannel = {
    onmessage: ((event: unknown) => void) | null;
};

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    createChannel: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
    tauriInvoke: mocks.tauriInvoke,
    createChannel: mocks.createChannel,
}));

describe('generateSchemaConstrainedNativeCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null without creating a channel outside Tauri', async () => {
        mocks.isTauri.mockReturnValue(false);

        const result = await generateSchemaConstrainedNativeCompletion({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            jsonSchema: '{"type":"object"}',
        });

        expect(result).toBeNull();
        expect(mocks.createChannel).not.toHaveBeenCalled();
        expect(mocks.tauriInvoke).not.toHaveBeenCalled();
    });

    it('should stream schema-constrained token events through a Tauri channel', async () => {
        mocks.isTauri.mockReturnValue(true);
        const channel: TestChannel = { onmessage: null };
        mocks.createChannel.mockResolvedValue(channel);
        mocks.tauriInvoke.mockImplementation(() => {
            channel.onmessage?.({ event: 'token', data: { text: '{"kind":' } });
            channel.onmessage?.({ event: 'token', data: { text: '"edit_plan"}' } });
            channel.onmessage?.({ event: 'done', data: { total_tokens: 2 } });
            return Promise.resolve(undefined);
        });
        const onToken = vi.fn();

        const result = await generateSchemaConstrainedNativeCompletion({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            jsonSchema: '{"type":"object"}',
            onToken,
            temperature: 0.1,
            maxTokens: 2048,
        });

        expect(mocks.createChannel).toHaveBeenCalled();
        expect(mocks.tauriInvoke).toHaveBeenCalledWith('schema_constrained_generation', {
            systemPrompt: 'system',
            userMessage: 'mute drums',
            jsonSchema: '{"type":"object"}',
            temperature: 0.1,
            maxTokens: 2048,
            onEvent: channel,
        });
        expect(onToken).toHaveBeenCalledTimes(2);
        expect(result).toBe('{"kind":"edit_plan"}');
    });

    it('should reject native error events after the invoke resolves', async () => {
        mocks.isTauri.mockReturnValue(true);
        const channel: TestChannel = { onmessage: null };
        mocks.createChannel.mockResolvedValue(channel);
        mocks.tauriInvoke.mockImplementation(() => {
            channel.onmessage?.({ event: 'error', data: { message: 'schema failed' } });
            return Promise.resolve(undefined);
        });

        await expect(
            generateSchemaConstrainedNativeCompletion({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                jsonSchema: '{"type":"object"}',
            })
        ).rejects.toThrow('schema failed');
    });

    it('should reject malformed channel payloads instead of appending unknown data', async () => {
        mocks.isTauri.mockReturnValue(true);
        const channel: TestChannel = { onmessage: null };
        mocks.createChannel.mockResolvedValue(channel);
        mocks.tauriInvoke.mockImplementation(() => {
            channel.onmessage?.({ event: 'token', data: { text: 12 } });
            return Promise.resolve(undefined);
        });

        await expect(
            generateSchemaConstrainedNativeCompletion({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                jsonSchema: '{"type":"object"}',
            })
        ).rejects.toThrow(/Invalid schema_constrained_generation event/);
    });

    it('should reject when the abort signal fires before native schema generation resolves', async () => {
        mocks.isTauri.mockReturnValue(true);
        const channel: TestChannel = { onmessage: null };
        mocks.createChannel.mockResolvedValue(channel);
        mocks.tauriInvoke.mockReturnValue(new Promise<never>(() => undefined));

        const aborter = new AbortController();
        const promise = generateSchemaConstrainedNativeCompletion({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            jsonSchema: '{"type":"object"}',
            signal: aborter.signal,
        });
        aborter.abort();

        await expect(promise).rejects.toThrow('aborted');
    });
});
