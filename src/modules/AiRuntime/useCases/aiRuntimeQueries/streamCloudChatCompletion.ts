import { streamCloudChatCompletion as streamCloudCompletion } from '../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
    await streamCloudCompletion(messages, onToken, options);
}
