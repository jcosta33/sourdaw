import { AGENT_EXECUTION_MODES, type AgentExecutionMode } from '../models/AgentExecutionMode';

export function resolveAgentExecutionMode(input: {
    chatMode: 'chat' | 'prompt';
    requestedMode?: unknown;
}): AgentExecutionMode {
    if (input.requestedMode === undefined) {
        return input.chatMode === 'prompt' ? 'apply' : 'explain';
    }
    const requestedMode = AGENT_EXECUTION_MODES.find((mode) => mode === input.requestedMode);
    if (!requestedMode) {
        throw new Error('Unsupported agent execution mode');
    }
    return requestedMode;
}
