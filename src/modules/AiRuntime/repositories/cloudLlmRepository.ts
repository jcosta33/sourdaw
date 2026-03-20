/**
 * Repository: Cloud LLM engine (Anthropic Claude API).
 *
 * Provides Claude API integration as the cloud tier fallback.
 * Uses Claude's native tool-use API (not XML/JSON injection into prompts)
 * for the highest-quality tool calling. Requires ANTHROPIC_API_KEY.
 *
 * Pricing: ~$0.01-0.05 per session at typical DAW usage.
 */

import Anthropic from '@anthropic-ai/sdk';

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { mcpToOpenAiTools } from '../helpers/mcpToolAdapter';
import { type ToolCallResult } from '../transformers/toolCallParser';

const logger = Container.getInstance().get(Logger);

// ── API key management ──────────────────────────────────────────────────

let apiKey: string | null = null;
let client: Anthropic | null = null;

/**
 * Set the Anthropic API key. Must be called before using cloud inference.
 * The key is stored in memory only (not persisted).
 */
export function setCloudApiKey(key: string): void {
    apiKey = key;
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    logger.info('[Cloud AI] API key set');
}

export function isCloudAvailable(): boolean {
    return apiKey !== null && client !== null;
}

export function clearCloudApiKey(): void {
    apiKey = null;
    client = null;
}

// ── Tool schema conversion ──────────────────────────────────────────────

/**
 * Get Claude-compatible tools via the MCP adapter.
 * The MCP adapter converts DAW_TOOL_SCHEMAS → MCP format → OpenAI/Claude format.
 * This is the universal tool definition path.
 */
function getClaudeTools(): Anthropic.Messages.Tool[] {
    return mcpToOpenAiTools().map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Anthropic.Messages.Tool.InputSchema,
    }));
}

// ── Tool-calling completion ─────────────────────────────────────────────

const CLOUD_MODEL = 'claude-sonnet-4-20250514';

const CLOUD_SYSTEM_PROMPT = `You are a professional music production AI integrated into a DAW (Digital Audio Workstation). Use the provided tools to execute all user requests. Never describe actions — execute them via tools. You understand music theory, mixing, mastering, and arrangement.

Key rules:
- Use multiple tools for complex requests (e.g. "set up a hip-hop session" = multiple addTrack + setTempo + addDevice calls)
- gain 0.0=silence, 0.8=unity/default, 1.0=maximum
- pan -50=hard left, 0=center, 50=hard right
- Bar 1 = beat 0, bar N = beat (N-1)*4 in 4/4 time
- MIDI: C4=60, 0.25=16th, 0.5=8th, 1=quarter, 4=whole note`;

/**
 * Generate tool calls via Claude API using native tool-use.
 * Returns parsed ToolCallResult[] compatible with the existing pipeline.
 *
 * @param projectState - Project context string to include in the user message
 * @param userMessage - The user's natural language request
 */
export async function generateCloudToolCalls(
    projectState: string,
    userMessage: string,
): Promise<ToolCallResult[]> {
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

    // Extract tool_use blocks from the response
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
        `[Cloud AI] Claude returned ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`,
    );

    return results;
}

// ── Streaming chat completion ───────────────────────────────────────────

/**
 * Stream a chat response from Claude (non-tool-calling, for the chat panel).
 */
export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number },
): Promise<void> {
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
