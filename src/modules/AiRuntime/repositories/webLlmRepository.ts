/**
 * Repository: WebLLM (browser WebGPU) engine.
 * Manages the Web Worker-based MLC engine lifecycle and completions.
 */

import { type ChatCompletionMessageParam, CreateWebWorkerMLCEngine } from '@mlc-ai/web-llm';

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { WEBLLM_MODEL_ID } from '../models/ModelInfo';
import { llmStatusStore } from '../stores/llmStatusStore';
import LlmWorker from './llmWorker?worker';

const logger = Container.getInstance().get(Logger);

type WebLlmEngine = Awaited<ReturnType<typeof CreateWebWorkerMLCEngine>>;

let engine: WebLlmEngine | null = null;
let initPromise: Promise<WebLlmEngine> | null = null;
let engineWorker: Worker | null = null;

export function initWebLlmEngine(): Promise<WebLlmEngine> {
    if (engine) {
        return Promise.resolve(engine);
    }
    if (initPromise) {
        return initPromise;
    }

    // WebGPU is required — absent on Linux (WebKitGTK) and older browsers
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return Promise.reject(
            new Error('WebGPU not available — WebLLM requires WebGPU. Use native or cloud backend instead.')
        );
    }

    initPromise = (async () => {
        llmStatusStore.set({ state: 'loading', progress: 0, text: 'Loading AI engine...' });

        const worker = new LlmWorker();
        engineWorker = worker;
        const created = await CreateWebWorkerMLCEngine(
            worker,
            WEBLLM_MODEL_ID,
            {
                initProgressCallback: (report) => {
                    llmStatusStore.set({
                        state: 'loading',
                        progress: report.progress,
                        text: report.text,
                    });
                },
            },
            { context_window_size: 4096 }
        );

        engine = created;
        llmStatusStore.set({ state: 'ready', modelId: WEBLLM_MODEL_ID });
        return created;
    })();

    return initPromise;
}

export function unloadWebLlmEngine(): void {
    if (engineWorker) {
        engineWorker.terminate();
        engineWorker = null;
    }
    engine = null;
    initPromise = null;
    logger.info('[AI Engine] WebLLM unloaded from memory');
}

export function isWebLlmLoaded(): boolean {
    return engine !== null;
}

export async function generateWebLlmCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    const eng = await initWebLlmEngine();
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = await eng.chat.completions.create({
        messages,
        temperature: 0.1,
        max_tokens: 1024,
        seed: 0,
        response_format: { type: 'json_object' },
    });
    return response.choices[0]?.message.content ?? '';
}

export function getLlmEngine(): WebLlmEngine | null {
    return engine;
}
