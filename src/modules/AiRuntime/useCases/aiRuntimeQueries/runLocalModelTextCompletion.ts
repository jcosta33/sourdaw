import { createModelProviderFailureError } from '../../errors/ModelProviderFailureError';
import {
    type ModelProviderEvent,
    type ModelProviderEventEnvelope,
    type ModelProviderFailure,
    type ModelProviderFinish,
    type ModelProviderFinishEnvelope,
    type ModelProviderName,
    type ModelProviderRequest,
} from '../../models/ModelProviderProtocol';
import { createModelProviderProtocol } from '../modelProviderProtocol';

type RunLocalModelTextCompletionBase = {
    provider: Extract<ModelProviderName, 'native' | 'webllm'>;
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxOutputTokens: number;
    signal?: AbortSignal;
};

type RunLocalModelTextCompletionInput = RunLocalModelTextCompletionBase &
    (
        | {
              execute: (systemPrompt: string, userMessage: string) => Promise<string>;
              executeRequest?: never;
          }
        | {
              execute?: never;
              executeRequest: (
                  request: ModelProviderRequest,
                  onEvent: (event: ModelProviderEventEnvelope) => void
              ) => Promise<
                  | { status: 'available'; finish: ModelProviderFinishEnvelope }
                  | { status: 'unavailable'; failure: ModelProviderFailure }
              >;
          }
    );

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
        throw createModelProviderFailureError(compiled.failure);
    }

    const session = protocol.start(compiled.request);
    let nextSequence = 0;
    const eventEnvelope = (event: ModelProviderEvent) => ({
        schemaVersion: compiled.request.schemaVersion,
        runId: compiled.request.runId,
        requestId: compiled.request.requestId,
        correlationId: compiled.request.correlationId,
        cancellationGeneration: compiled.request.cancellationGeneration,
        sequence: nextSequence++,
        event,
    });
    const finishEnvelope = (finish: ModelProviderFinish) => ({
        schemaVersion: compiled.request.schemaVersion,
        runId: compiled.request.runId,
        requestId: compiled.request.requestId,
        correlationId: compiled.request.correlationId,
        cancellationGeneration: compiled.request.cancellationGeneration,
        sequence: nextSequence++,
        finish,
    });
    let settled = false;
    try {
        input.signal?.throwIfAborted();
        if (input.executeRequest !== undefined) {
            const outcome = await input.executeRequest(compiled.request, (event) => {
                session.push(event);
                nextSequence = event.sequence + 1;
            });
            if (outcome.status === 'unavailable') {
                session.finish(
                    finishEnvelope({
                        reason: 'error',
                        failure: outcome.failure,
                    })
                );
                settled = true;
                throw createModelProviderFailureError(outcome.failure);
            }
            const result = session.finish(outcome.finish);
            settled = true;
            if (result.status !== 'complete') {
                if (result.failure !== null) {
                    throw createModelProviderFailureError(result.failure);
                }
                throw new Error('The model provider request did not complete.');
            }
            return result.output.text;
        }
        const systemPrompt = compiled.request.messages.find((message) => message.role === 'system')?.content;
        const userMessage = compiled.request.messages.find((message) => message.role === 'user')?.content;
        if (systemPrompt === undefined || userMessage === undefined) {
            throw new Error('The model provider request is missing required messages.');
        }
        const text = await input.execute(systemPrompt, userMessage);
        input.signal?.throwIfAborted();
        session.push(eventEnvelope({ type: 'text', mode: 'cumulative-snapshot', text }));
        const result = session.finish(finishEnvelope({ reason: 'stop' }));
        settled = true;
        if (result.status !== 'complete') {
            if (result.failure !== null) {
                throw createModelProviderFailureError(result.failure);
            }
            throw new Error('The model provider request did not complete.');
        }
        return result.output.text;
    } catch (error) {
        if (!settled) {
            if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
                session.finish(finishEnvelope({ reason: 'cancelled' }));
            } else {
                const result = session.finish(
                    finishEnvelope({
                        reason: 'error',
                        failure: {
                            code: 'local-provider-failed',
                            retryable: true,
                            safeMessage: 'The local model provider request failed.',
                        },
                    })
                );
                if (result.failure !== null) {
                    throw createModelProviderFailureError(result.failure, error);
                }
            }
        }
        throw error;
    }
}
