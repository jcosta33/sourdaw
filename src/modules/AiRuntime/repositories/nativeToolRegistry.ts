/**
 * Repository: Native (Rust) tool registry via Tauri IPC.
 *
 * Provides typed access to the Rust-side ToolRegistry:
 *  - `getNativeToolSchemas` — fetch all registered tool schemas
 *  - `getNativeToolsPrompt` — get pre-formatted tools JSON for LLM prompt
 *  - `parseNativeToolCalls` — parse tool calls from LLM output text (Rust impl)
 *
 * In browser-only mode, these gracefully return empty/fallback values so the
 * TS-side toolDefinitions.ts continues to work as the primary source.
 */

import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';
import { type ToolCallResult } from '../transformers/toolCallParser';

// Re-export so consumers only need one type for tool call results
export type { ToolCallResult };

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Get the pre-formatted tools JSON block for inclusion in the LLM system prompt.
 *
 * This is the Rust-side equivalent of `toolDefinitions.ts` — returns the tools
 * in OpenAI function-calling JSON format, ready for `<tools>...</tools>` injection.
 *
 * Returns an empty string in browser-only mode (the TS-side definitions are used instead).
 */
export async function getNativeToolsPrompt(): Promise<string> {
    if (!isTauri()) {
        return '';
    }
    return (await tauriInvoke('get_tools_prompt')) as string;
}

/**
 * Parse tool calls from LLM output text using the Rust parser.
 *
 * Falls back to an empty array in browser-only mode
 * (the TS-side `toolCallParser.ts` handles parsing instead).
 */
export async function parseNativeToolCalls(text: string): Promise<ToolCallResult[]> {
    if (!isTauri()) {
        return [];
    }
    return (await tauriInvoke('parse_llm_tool_calls', { text })) as ToolCallResult[];
}
