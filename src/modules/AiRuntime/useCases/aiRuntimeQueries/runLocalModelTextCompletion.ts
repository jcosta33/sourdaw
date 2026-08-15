import { type ModelProviderName } from '../../models/ModelProviderProtocol';
import { createModelProviderProtocol } from '../modelProviderProtocol';

type RunLocalModelTextCompletionInput = {
    provider: Extract<ModelProviderName, 'native' | 'webllm'>;
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxOutputTokens: number;
    signal?: AbortSignal;
    execute: (systemPrompt: string, userMessage: string) => Promise<string>;
};

export async function runLocalModelTextCompletion(input: RunLocalModelTextCompletionInput): Promise<string> {
    const protocol = createModelProviderProtocol({ provider: input.provider, model: input.model });
    const compiled = protocol.compileRequest({
        correlationId: `model-text-${crypto.randomUUID()}`,
        operation: 'text',
        modality: 'text',
        messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userMessage },
        ],
        stream: false,
        limits: { maxOutputTokens: input.maxOutputTokens },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: {
            maxInputTokens: 32_768,
            maxOutputTokens: input.maxOutputTokens,
            maxTotalTokens: 32_768 + input.maxOutputTokens,
        },
        dataPolicy: 'local-only',
    });
    if (compiled.status === 'unavailable') {
        throw new Error(compiled.failure.safeMessage);
    }

    const session = protocol.start(compiled.request);
    let settled = false;
    try {
        input.signal?.throwIfAborted();
        const systemPrompt = compiled.request.messages.find((message) => message.role === 'system')?.content;
        const userMessage = compiled.request.messages.find((message) => message.role === 'user')?.content;
        if (systemPrompt === undefined || userMessage === undefined) {
            throw new Error('The model provider request is missing required messages.');
        }
        const text = await input.execute(systemPrompt, userMessage);
        input.signal?.throwIfAborted();
        session.push({ type: 'text', mode: 'cumulative-snapshot', text });
        const result = session.finish({ reason: 'stop' });
        settled = true;
        if (result.status !== 'complete') {
            throw new Error(result.failure?.safeMessage ?? 'The model provider request did not complete.');
        }
        return result.output.text;
    } catch (error) {
        if (!settled) {
            if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
                session.finish({ reason: 'cancelled' });
            } else {
                session.finish({
                    reason: 'error',
                    failure: {
                        code: 'local-provider-failed',
                        retryable: true,
                        safeMessage: 'The local model provider request failed.',
                    },
                });
            }
        }
        throw error;
    }
}
