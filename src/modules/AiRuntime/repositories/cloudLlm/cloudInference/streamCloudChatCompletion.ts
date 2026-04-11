import { getCloudClient } from '../keyManagement';
import { CLOUD_MODEL } from './helpers';

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