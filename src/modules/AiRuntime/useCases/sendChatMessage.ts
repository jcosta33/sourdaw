import { orchestrateChatMessage } from './agentRequestOrchestration/orchestrateChatMessage';

export async function sendChatMessage(
    userText: string,
    options?: Parameters<typeof orchestrateChatMessage>[1]
): ReturnType<typeof orchestrateChatMessage> {
    return orchestrateChatMessage(userText, options);
}
