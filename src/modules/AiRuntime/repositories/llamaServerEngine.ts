/**
 * Repository: llama-server sidecar engine.
 * Communicates with the native llama-server sidecar via Tauri IPC commands.
 * All HTTP traffic to the sidecar is proxied through Rust to avoid CSP issues.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri, tauriInvoke, createChannel } from '#/helpers/tauriBridge';

import { NATIVE_MODEL_INFO } from '../models/ModelInfo';

const logger = Container.getInstance().get(Logger);

const SIDECAR_PORT = 8847;
const BASE_URL = `http://127.0.0.1:${String(SIDECAR_PORT)}`;

let sidecarRunning = false;

// ── Health check (browser dev mode only) ────────────────────────────────

async function checkLlamaServerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

// ── Sidecar lifecycle ───────────────────────────────────────────────────

/**
 * Start the llama-server sidecar.
 * - In Tauri: starts via Rust sidecar management (shell plugin)
 * - In browser dev mode: checks if llama-server is already running
 */
export async function initLlamaServer(): Promise<void> {
    if (isTauri()) {
        const modelDir = (await tauriInvoke('get_model_dir')) as string;
        const modelPath = `${modelDir}/${NATIVE_MODEL_INFO.fileName}`;

        logger.info(`[Native AI] Starting sidecar with model: ${modelPath}`);

        await tauriInvoke('start_llm_sidecar', {
            request: {
                model_path: modelPath,
                port: SIDECAR_PORT,
                n_gpu_layers: 99,
                ctx_size: 4096,
            },
        });

        sidecarRunning = true;
        logger.info(`[Native AI] Sidecar started on port ${String(SIDECAR_PORT)}`);
        return;
    }

    // Browser dev mode: check if llama-server is manually running
    logger.info('[Native AI] Browser mode — checking if llama-server is running...');
    const healthy = await checkLlamaServerHealth();
    if (healthy) {
        sidecarRunning = true;
        logger.info(`[Native AI] Connected to llama-server on port ${String(SIDECAR_PORT)}`);
        return;
    }

    throw new Error(
        `llama-server not reachable at ${BASE_URL}. ` +
            `Start it manually: llama-server --model <path-to-gguf> --port ${String(SIDECAR_PORT)} --host 127.0.0.1 --n-gpu-layers 99`
    );
}

/**
 * Stop the llama-server sidecar.
 */
export async function stopLlamaServer(): Promise<void> {
    if (isTauri()) {
        await tauriInvoke('stop_llm_sidecar');
    }
    sidecarRunning = false;
    logger.info('[Native AI] Sidecar stopped');
}

export function isLlamaServerRunning(): boolean {
    return sidecarRunning;
}

// ── Model management ────────────────────────────────────────────────────

/**
 * Check if the native model file exists on disk (Tauri only).
 */
export async function isNativeModelDownloaded(): Promise<boolean> {
    if (!isTauri()) {
        return sidecarRunning;
    }
    try {
        const modelDir = (await tauriInvoke('get_model_dir')) as string;
        const result = (await tauriInvoke('list_directory', { path: modelDir })) as Array<{ name: string }>;
        return result.some((entry) => entry.name === NATIVE_MODEL_INFO.fileName);
    } catch {
        return false;
    }
}

/**
 * Get the model directory path for display.
 */
export async function getModelDir(): Promise<string> {
    if (!isTauri()) {
        return '(start llama-server manually)';
    }
    return (await tauriInvoke('get_model_dir')) as string;
}

// ── Completions ─────────────────────────────────────────────────────────

/**
 * Non-streaming completion via the llama-server.
 * In Tauri: proxied through Rust to avoid CSP issues.
 * In browser dev mode: direct fetch to localhost.
 */
export async function generateNativeCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    if (isTauri()) {
        return (await tauriInvoke('generate_llm_completion', {
            request: {
                system_prompt: systemPrompt,
                user_message: userMessage,
                temperature: 0.1,
                max_tokens: 1024,
            },
        })) as string;
    }

    // Browser dev mode: direct fetch
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 1024,
            seed: 0,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string | null } }> };
    return data.choices[0]?.message.content ?? '';
}

// ── Streaming ───────────────────────────────────────────────────────────

type LlmStreamEvent =
    | { event: 'token'; data: { text: string } }
    | { event: 'done'; data: { totalTokens: number } }
    | { event: 'error'; data: { message: string } };

/**
 * Streaming completion via Tauri's Channel API.
 * Calls the Rust `stream_llm_completion` command which proxies SSE from llama-server.
 * Falls back to direct SSE fetch in browser dev mode.
 */
export async function streamNativeCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number },
): Promise<void> {
    if (isTauri()) {
        const channel = await createChannel<LlmStreamEvent>();
        channel.onmessage = (event: LlmStreamEvent) => {
            if (event.event === 'token') {
                onToken(event.data.text);
            }
            if (event.event === 'error') {
                throw new Error(event.data.message);
            }
        };

        await tauriInvoke('stream_llm_completion', {
            request: {
                system_prompt: messages.find((m) => m.role === 'system')?.content ?? '',
                messages: messages.filter((m) => m.role !== 'system'),
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? 2048,
            },
            onEvent: channel,
        });
        return;
    }

    // Browser dev mode: direct SSE fetch
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048,
            seed: 0,
            stream: true,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) {
                continue;
            }
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') {
                return;
            }
            try {
                const chunk = JSON.parse(jsonStr) as { choices: Array<{ delta: { content?: string } }> };
                const content = chunk.choices[0]?.delta.content;
                if (content) {
                    onToken(content);
                }
            } catch {
                // Skip malformed SSE chunks
            }
        }
    }
}
