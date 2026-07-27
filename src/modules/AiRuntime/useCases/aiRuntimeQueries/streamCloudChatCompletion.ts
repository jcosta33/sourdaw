import {
    type CloudChatCompletionOutcome,
    streamCloudChatCompletion as streamCloudCompletion,
} from '../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<CloudChatCompletionOutcome> {
    return streamCloudCompletion(messages, onToken, options);
}
