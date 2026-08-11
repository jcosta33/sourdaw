export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatActionConfirmationStatus =
    'proposed' | 'accepted' | 'executed' | 'failed' | 'cancelled' | 'invalidated';

export type ChatActionFollowUpStatus = 'retryable' | 'running' | 'complete' | 'failed';

export type ChatMessage = {
    id: string;
    role: ChatRole;
    content: string;
    timestamp: number;
    isStreaming?: boolean;
    error?: string;
    /** Hidden reasoning tokens from the model (collapsible in UI) */
    reasoning?: string;
    /** Whether this message is an executable prompt-command receipt rather than ordinary chat. */
    isCommandAction?: boolean;
    /** Pending prompt-action confirmation owned by AiRuntime. */
    pendingActionConfirmationId?: string;
    pendingActionConfirmationStatus?: ChatActionConfirmationStatus;
    pendingActionFollowUpStatus?: ChatActionFollowUpStatus;
};

export type ChatState = {
    messages: ChatMessage[];
    isGenerating: boolean;
    enableReasoning: boolean;
    chatMode: 'chat' | 'prompt';
};
