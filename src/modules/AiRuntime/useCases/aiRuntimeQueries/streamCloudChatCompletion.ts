import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { discloseRemoteTransmission } from '../discloseRemoteTransmission';
import { streamHostedModelText } from '../streamHostedModelText';

type CloudChatCompletionOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<CloudChatCompletionOutcome> {
    const result = await streamHostedModelText({
        correlationId: `hosted-text-${crypto.randomUUID()}`,
        messages: messages.map((message) => ({
            role:
                message.role === 'system' || message.role === 'assistant' || message.role === 'user'
                    ? message.role
                    : 'user',
            content: message.content,
        })),
        maxOutputTokens: options?.maxTokens ?? 2_048,
        temperature: options?.temperature,
        onToken,
        signal: options?.signal,
        remoteDisclosure: discloseRemoteTransmission(REMOTE_TEXT_AGENT_DATA_CATEGORIES),
    });
    if (result.status === 'complete') {
        return { status: 'complete' };
    }
    if (result.finishReason === 'length') {
        return { status: 'incomplete', reason: 'token limit' };
    }
    throw new Error(result.failure?.safeMessage ?? 'The hosted model provider request did not complete.');
}
