import Anthropic from '@anthropic-ai/sdk';

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { mcpToOpenAiTools } from '../../repositories/mcpToolAdapter';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { getCloudClient } from './keyManagement';

const logger = Container.getInstance().get(Logger);

const CLOUD_MODEL = 'claude-sonnet-4-20250514';

const CLOUD_SYSTEM_PROMPT = `You are a professional music production AI integrated into a DAW (Digital Audio Workstation). Use the provided tools to execute all user requests. Never describe actions — execute them via tools. You understand music theory, mixing, mastering, and arrangement.

Key rules:
- Use multiple tools for complex requests (e.g. "set up a hip-hop session" = multiple addTrack + setTempo + addDevice calls)
- gain 0.0=silence, 0.8=unity/default, 1.0=maximum
- pan -50=hard left, 0=center, 50=hard right
- Bar 1 = beat 0, bar N = beat (N-1)*4 in 4/4 time
- MIDI: C4=60, 0.25=16th, 0.5=8th, 1=quarter, 4=whole note`;

function getClaudeTools(): Anthropic.Messages.Tool[] {
    return mcpToOpenAiTools().map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Anthropic.Messages.Tool.InputSchema,
    }));
}

export async function generateCloudToolCalls(projectState: string, userMessage: string): Promise<ToolCallResult[]> {
    const client = getCloudClient();
    if (!client) {
        throw new Error('Cloud AI not configured. Set API key first.');
    }

    const response = await client.messages.create({
        model: CLOUD_MODEL,
        max_tokens: 2048,
        system: CLOUD_SYSTEM_PROMPT,
        tools: getClaudeTools(),
        messages: [
            {
                role: 'user',
                content: `${projectState}\n\nUser request: ${userMessage}`,
            },
        ],
    });

    const results: ToolCallResult[] = [];
    for (const block of response.content) {
        if (block.type === 'tool_use') {
            results.push({
                name: block.name,
                arguments: (block.input ?? {}) as Record<string, unknown>,
            });
        }
    }

    logger.info(
        `[Cloud AI] Claude returned ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
    );

    return results;
}

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
    const client = getCloudClient();
    if (!client) {
        throw new Error('Cloud AI not configured. Set API key first.');
    }

    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

    const stream = client.messages.stream({
        model: CLOUD_MODEL,
        max_tokens: options?.maxTokens ?? 2048,
        system: systemMessage?.content ?? 'You are a helpful music production assistant embedded in a DAW.',
        messages: chatMessages,
    });

    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            onToken(event.delta.text);
        }
    }
}
